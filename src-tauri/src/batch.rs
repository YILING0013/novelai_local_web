use crate::service::*;
use serde_json::Value;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
const INTERVAL: Duration = Duration::from_secs(15);
pub struct Batch {
    pub owner: String,
    size: u64,
    next: u64,
    stamp: Instant,
    terminal: Option<&'static str>,
}
pub struct Lease {
    core: Shared,
    key: Option<String>,
    ok: bool,
}
fn error(code: &str, msg: &str) -> Fault {
    Fault(409, code.into(), msg.into())
}
fn prune(map: &mut std::collections::HashMap<String, Batch>) {
    map.retain(|_, v| v.stamp.elapsed() < Duration::from_secs(3600));
}
impl Lease {
    pub fn start(core: &Shared, caller: &str, b: &Value) -> Res<Self> {
        let explicit = ["batch_id", "batch_size", "index"]
            .iter()
            .any(|k| b.get(k).is_some_and(|v| !v.is_null()));
        if !explicit {
            return Ok(Self {
                core: Arc::clone(core),
                key: None,
                ok: false,
            });
        }
        let name = field(b, "batch_id", 128)?;
        let size = b["batch_size"]
            .as_u64()
            .filter(|v| (1..=8).contains(v))
            .ok_or_else(|| Fault::bad("Invalid batch size."))?;
        let index = b["index"]
            .as_u64()
            .filter(|v| *v < size)
            .ok_or_else(|| Fault::bad("Invalid batch index."))?;
        let mut map = core.batches.lock().unwrap();
        prune(&mut map);
        if !map.contains_key(&name) {
            if index != 0 {
                return Err(error("BATCH_OUT_OF_ORDER", "Start at the first image."));
            }
            if map.values().any(|v| v.terminal.is_none()) {
                return Err(error("IMAGE_BATCH_ACTIVE", "Another batch is active."));
            }
            map.insert(
                name.clone(),
                Batch {
                    owner: caller.into(),
                    size,
                    next: 0,
                    stamp: Instant::now(),
                    terminal: None,
                },
            );
        }
        let b = map.get(&name).unwrap();
        if b.owner != caller {
            return Err(error(
                "BATCH_OWNER_MISMATCH",
                "Batch belongs to another session.",
            ));
        }
        if b.terminal == Some("cancelled") {
            return Err(error("BATCH_CANCELLED", "Batch cancelled."));
        }
        if b.terminal.is_some() {
            return Err(error("BATCH_TERMINAL", "This batch has finished."));
        }
        if b.size != size {
            return Err(error("BATCH_SIZE_MISMATCH", "Batch size changed."));
        }
        if b.next != index {
            return Err(error("BATCH_OUT_OF_ORDER", "Incorrect index."));
        }
        if index > 0 && b.stamp.elapsed() < INTERVAL {
            return Err(Fault(
                429,
                "IMAGE_INTERVAL_ACTIVE".into(),
                format!(
                    "{:.3}",
                    INTERVAL.saturating_sub(b.stamp.elapsed()).as_secs_f64()
                ),
            ));
        }
        Ok(Self {
            core: Arc::clone(core),
            key: Some(name),
            ok: false,
        })
    }
    pub fn complete(&mut self) {
        self.ok = true;
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        let Some(key) = &self.key else { return };
        let mut map = self.core.batches.lock().unwrap();
        let Some(b) = map.get_mut(key) else { return };
        if b.terminal.is_none() {
            if self.ok {
                b.next += 1;
                if b.next == b.size {
                    b.terminal = Some("completed")
                }
            } else {
                b.terminal = Some("failed")
            }
        }
        b.stamp = Instant::now();
    }
}
pub fn cancel(c: &Core, caller: &str, name: &str) -> Res<()> {
    let mut map = c.batches.lock().unwrap();
    prune(&mut map);
    let b = map.entry(name.into()).or_insert_with(|| Batch {
        owner: caller.into(),
        size: 0,
        next: 0,
        stamp: Instant::now(),
        terminal: None,
    });
    if b.owner != caller {
        return Err(error(
            "BATCH_OWNER_MISMATCH",
            "Batch belongs to another session.",
        ));
    }
    b.terminal = Some("cancelled");
    b.stamp = Instant::now();
    Ok(())
}

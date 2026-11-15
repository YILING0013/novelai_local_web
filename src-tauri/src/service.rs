use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as V};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use uuid::Uuid;

pub type Res<T> = Result<T, Fault>;
#[derive(Debug)]
pub struct Fault(pub u16, pub String, pub String);
impl Fault {
    pub fn bad(s: &str) -> Self {
        Self(400, "INVALID_REQUEST".into(), s.into())
    }
    pub fn missing() -> Self {
        Self(
            404,
            "NOT_FOUND".into(),
            "The requested item was not found.".into(),
        )
    }
    pub fn unsupported() -> Self {
        Self(
            501,
            "NOT_IMPLEMENTED".into(),
            "This operation is not yet available in the native backend.".into(),
        )
    }
}
impl From<rusqlite::Error> for Fault {
    fn from(_: rusqlite::Error) -> Self {
        Self(
            500,
            "DATABASE_ERROR".into(),
            "Local database operation failed.".into(),
        )
    }
}
impl From<std::io::Error> for Fault {
    fn from(e: std::io::Error) -> Self {
        Self(500, "FILESYSTEM_ERROR".into(), e.to_string())
    }
}
impl From<serde_json::Error> for Fault {
    fn from(_: serde_json::Error) -> Self {
        Self::bad("Invalid JSON document.")
    }
}
#[derive(Serialize, Debug)]
pub struct Reply {
    pub status: u16,
    pub body: V,
}
impl From<Fault> for Reply {
    fn from(f: Fault) -> Self {
        if f.1 == "IMAGE_INTERVAL_ACTIVE" {
            return Self {
                status: f.0,
                body: json!({"error":"Please wait before starting the next image.","code":f.1,"retry_after":f.2.parse::<f64>().unwrap_or(15.)}),
            };
        }
        Self {
            status: f.0,
            body: json!({"error":f.2,"code":f.1,"message":f.2}),
        }
    }
}
pub fn id() -> String {
    Uuid::new_v4().simple().to_string()
}
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
pub fn s<'a>(v: &'a V, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("")
}
pub fn field(v: &V, k: &str, limit: usize) -> Res<String> {
    v[k].as_str()
        .map(str::trim)
        .filter(|x| !x.is_empty() && x.chars().count() <= limit)
        .map(str::to_owned)
        .ok_or_else(|| Fault::bad(&format!("Invalid {k}.")))
}
pub fn load(db: &Connection, kind: &str, k: &str) -> Res<Option<V>> {
    let raw = db
        .query_row(
            "SELECT v FROM docs WHERE kind=?1 AND k=?2",
            params![kind, k],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    Ok(raw.map(|t| serde_json::from_str(&t)).transpose()?)
}
pub fn get(db: &Connection, kind: &str, k: &str) -> Res<V> {
    load(db, kind, k)?.ok_or_else(Fault::missing)
}
pub fn all(db: &Connection, kind: &str) -> Res<Vec<V>> {
    let mut stmt = db.prepare("SELECT v FROM docs WHERE kind=? ORDER BY rowid")?;
    let vals = stmt
        .query_map([kind], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(vals
        .iter()
        .map(|v| serde_json::from_str(v))
        .collect::<Result<Vec<_>, _>>()?)
}
pub fn put(db: &Connection, kind: &str, k: &str, v: &V) -> Res<()> {
    db.execute(
        "INSERT INTO docs VALUES(?1,?2,?3) ON CONFLICT(kind,k) DO UPDATE SET v=excluded.v",
        params![kind, k, v.to_string()],
    )?;
    Ok(())
}
pub fn del(db: &Connection, kind: &str, k: &str) -> Res<()> {
    db.execute("DELETE FROM docs WHERE kind=?1 AND k=?2", params![kind, k])?;
    Ok(())
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Session {
    pub token: String,
    pub csrf: String,
    pub snapshot: V,
}
impl Session {
    pub fn public(&self) -> V {
        json!({"authenticated":true,"csrf_token":self.csrf,"account_snapshot":self.snapshot})
    }
}
pub struct Core {
    pub operation_gate: Arc<tokio::sync::RwLock<()>>,
    pub picked: Mutex<HashMap<String, (PathBuf, std::time::Instant)>>,
    pub credential_lock: tokio::sync::Mutex<()>,
    pub memory_keys: Mutex<HashMap<(String, String), String>>,
    #[cfg(test)]
    pub mock: std::sync::OnceLock<fn(&str, Option<&V>) -> Res<(Vec<u8>, String)>>,
    pub app: std::sync::OnceLock<tauri::AppHandle>,
    pub tasks: crate::jobs::Jobs,
    pub image_lock: tokio::sync::Mutex<()>,
    pub root: PathBuf,
    pub resources: PathBuf,
    pub db: Mutex<Connection>,
    pub sessions: Mutex<HashMap<String, Session>>,
    pub batches: Mutex<HashMap<String, crate::batch::Batch>>,
}
pub type Shared = Arc<Core>;
pub type Query = HashMap<String, String>;
impl Core {
    pub fn open(root: &Path, resources: &Path) -> Res<Shared> {
        std::fs::create_dir_all(root.join("objects"))?;
        let db = Connection::open(root.join("library.sqlite3"))?;
        db.execute_batch("PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS docs(kind TEXT NOT NULL,k TEXT NOT NULL,v TEXT NOT NULL,PRIMARY KEY(kind,k));")?;
        let mut sessions = HashMap::new();
        if let Some(encrypted) = load(&db, "private", "session")? {
            use base64::Engine;
            if let Some(entry) = encrypted
                .as_str()
                .and_then(|x| base64::engine::general_purpose::STANDARD.decode(x).ok())
                .and_then(|x| crate::secrets::unprotect(&x).ok())
                .and_then(|x| serde_json::from_slice::<Session>(&x).ok())
            {
                sessions.insert("desktop".into(), entry);
            }
        }
        Ok(Arc::new(Self {
            operation_gate: Default::default(),
            #[cfg(test)]
            mock: Default::default(),
            credential_lock: Default::default(),
            memory_keys: Default::default(),
            app: Default::default(),
            picked: Default::default(),
            tasks: Default::default(),
            image_lock: Default::default(),
            root: root.to_owned(),
            resources: resources.to_owned(),
            db: Mutex::new(db),
            sessions: Mutex::new(sessions),
            batches: Mutex::new(HashMap::new()),
        }))
    }
    pub fn session(&self, caller: &str) -> Option<Session> {
        self.sessions.lock().unwrap().get(caller).cloned()
    }
    pub fn persist(&self, caller: &str, session: Option<Session>) -> Res<()> {
        if caller == "desktop" {
            use base64::Engine;
            let db = self.db.lock().unwrap();
            if let Some(ref sess) = session {
                let blob = crate::secrets::protect(&serde_json::to_vec(sess)?).map_err(|_| {
                    Fault(
                        500,
                        "DPAPI_ERROR".into(),
                        "Windows could not protect the credential.".into(),
                    )
                })?;
                put(
                    &db,
                    "private",
                    "session",
                    &json!(base64::engine::general_purpose::STANDARD.encode(blob)),
                )?
            } else {
                del(&db, "private", "session")?
            }
        }
        let mut map = self.sessions.lock().unwrap();
        if let Some(sess) = session {
            map.insert(caller.into(), sess);
        } else {
            map.remove(caller);
            self.memory_keys
                .lock()
                .unwrap()
                .retain(|(owner, _), _| owner != caller);
        }
        Ok(())
    }
    pub fn asset(&self, path: &str) -> Res<(Vec<u8>, String)> {
        let parts = path.trim_start_matches('/').split('/').collect::<Vec<_>>();
        let (kind, key, thumb) = match &parts[..] {
            ["api", "local", "gallery", key, op @ ("file" | "thumbnail")] => {
                ("image", *key, *op == "thumbnail")
            }
            ["api", "local", "versions", "assets", key] => ("asset", *key, false),
            ["api", "local", "versions", "assets", key, "thumbnail"] => ("asset", *key, true),
            _ => return Err(Fault::missing()),
        };
        if !key.bytes().all(|x| x.is_ascii_hexdigit()) || ![32, 64].contains(&key.len()) {
            return Err(Fault::missing());
        }
        let record = get(&self.db.lock().unwrap(), kind, key)?;
        let hash = s(&record, "digest");
        if hash.len() != 64 || !hash.bytes().all(|x| x.is_ascii_hexdigit()) {
            return Err(Fault::missing());
        }
        Ok((
            std::fs::read(self.root.join("objects").join(if thumb {
                format!("{hash}.thumb.png")
            } else {
                hash.into()
            }))?,
            if thumb {
                "image/png".into()
            } else {
                s(&record, "mime_type").into()
            },
        ))
    }
    pub async fn dispatch(
        self: &Arc<Self>,
        caller: &str,
        method: &str,
        path: &str,
        body: V,
    ) -> Reply {
        let _operation = match self.operation_gate.try_read() {
            Ok(guard) => guard,
            Err(_) => {
                return Fault(
                    503,
                    "UPDATE_INSTALLING".into(),
                    "The application is installing an update.".into(),
                )
                .into()
            }
        };
        let (path, qs) = path.split_once('?').unwrap_or((path, ""));
        let query: Query = serde_urlencoded::from_str(qs).unwrap_or_default();
        let parts = path.trim_start_matches('/').split('/').collect::<Vec<_>>();
        let session = self.session(caller);
        let result = async {
            let recovery = crate::account::status(self)?;
            if recovery["active"] == true
                && method == "POST"
                && !path.ends_with("/recovery/resolve")
                && (path.starts_with("/api/session/")
                    || path.starts_with("/api/images/")
                    || path.starts_with("/api/account/")
                    || path == "/api/comic/plan")
            {
                return Err(Fault(
                    409,
                    "ACCOUNT_RECOVERY_REQUIRED".into(),
                    "Resolve the pending credential change first.".into(),
                ));
            }
            match (&parts[..], method) {
                (["api", "account", "recovery"], "GET") => Ok(recovery),
                (["api", "account", "recovery", "resolve"], "POST") => {
                    crate::account::change(self, caller, "resolve", session.as_ref(), &body).await
                }
                (["api", "account", op @ ("change-password" | "change-email")], "POST") => {
                    crate::account::change(self, caller, op, session.as_ref(), &body).await
                }

                (["api", "session"], "GET") => Ok(session
                    .as_ref()
                    .map(Session::public)
                    .unwrap_or_else(|| json!({"authenticated":false}))),
                (["api", "session", mode @ ("password" | "persistent-token")], "POST") => {
                    let sess = crate::official::login(self, mode, &body).await?;
                    let out = sess.public();
                    self.persist(caller, Some(sess))?;
                    Ok(out)
                }
                (["api", "session"], "DELETE") => {
                    self.persist(caller, None)?;
                    Ok(json!({"authenticated":false}))
                }
                _ if caller != "desktop" && session.is_none() => {
                    Err(Fault(401, "AUTH_REQUIRED".into(), "Sign in first.".into()))
                }
                (["api", "local", "inference", rest @ ..], _) => {
                    crate::jobs::route(self, caller, method, rest, &body).await
                }
                (["api", "local", rest @ ..], _) => {
                    crate::library::handle(self, method, rest, &query, &body)
                }
                (["api", "comic", op], _) => {
                    crate::comic::route(self, caller, session.as_ref(), method, op, &body).await
                }
                (["api", "account"], "GET") => {
                    let mut sess = session.ok_or_else(|| {
                        Fault(401, "AUTH_REQUIRED".into(), "Sign in first.".into())
                    })?;
                    let fresh = crate::official::snapshot(
                        self,
                        &sess.token,
                        s(&sess.snapshot["auth"], "login_mode"),
                        s(&sess.snapshot["information"], "email"),
                    )
                    .await;
                    match fresh {
                        Ok(v) => sess.snapshot = v,
                        Err(f) if f.0 == 401 => {
                            if self
                                .session(caller)
                                .is_some_and(|cur| cur.csrf == sess.csrf)
                            {
                                self.persist(caller, None)?;
                            }
                            return Err(f);
                        }
                        Err(f) => return Err(f),
                    }
                    if self.session(caller).is_none_or(|cur| cur.csrf != sess.csrf) {
                        return Err(Fault(401, "AUTH_REQUIRED".into(), "Session ended.".into()));
                    }
                    self.persist(caller, Some(sess.clone()))?;
                    Ok(json!({"account_snapshot":sess.snapshot}))
                }

                (["api", rest @ ..], _) => {
                    crate::official::operation(
                        self,
                        caller,
                        session.as_ref(),
                        method,
                        rest,
                        &query,
                        &body,
                    )
                    .await
                }
                _ => Err(Fault::missing()),
            }
        }
        .await;
        match result {
            Ok(v) => Reply {
                status: if path == "/api/local/inference/jobs" && method == "POST" {
                    202
                } else if path == "/api/local/notes" && method == "POST" {
                    201
                } else {
                    200
                },
                body: v,
            },
            Err(f) => f.into(),
        }
    }
}

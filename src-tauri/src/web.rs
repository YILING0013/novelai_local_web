use crate::service::*;
use axum::{
    body::to_bytes,
    extract::{DefaultBodyLimit, FromRequest, Multipart, Request, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::any,
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as V};
use std::{
    net::{IpAddr, Ipv4Addr},
    path::Component,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tokio::{net::TcpListener, sync::Mutex, task::JoinHandle};
use tokio_util::sync::CancellationToken;
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct Config {
    pub enabled: bool,
    pub lan: bool,
    pub port: u16,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 5000,
            lan: false,
        }
    }
}
struct Running {
    stop: CancellationToken,
    active: Arc<AtomicBool>,
    task: JoinHandle<()>,
    prefix: String,
}
pub struct Web {
    pub core: Shared,
    inner: Mutex<(Config, Option<Running>, Option<String>)>,
}
#[derive(Clone)]
struct Site {
    stop: CancellationToken,
    core: Shared,
    prefix: String,
    cfg: Config,
    active: Arc<AtomicBool>,
}
fn urls(c: &Config) -> Vec<String> {
    let mut urls = vec![format!("http://127.0.0.1:{}", c.port)];
    if c.lan {
        if let Ok(ip) = local_ip_address::list_afinet_netifas() {
            for (_, ip) in ip {
                if matches!(ip,IpAddr::V4(v) if v.is_private()) {
                    let u = format!("http://{ip}:{}", c.port);
                    if !urls.contains(&u) {
                        urls.push(u)
                    }
                }
            }
        }
    }
    urls
}
impl Web {
    pub fn new(core: Shared) -> Self {
        let c = load(&core.db.lock().unwrap(), "private", "web")
            .ok()
            .flatten()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        Self {
            core,
            inner: Mutex::new((c, None, None)),
        }
    }
    pub async fn restore(&self) {
        let c = self.inner.lock().await.0.clone();
        if c.enabled {
            let _ = self.set(c).await;
        }
    }
    pub async fn status(&self) -> V {
        let x = self.inner.lock().await;
        json!({"enabled":x.0.enabled,"port":x.0.port,"lan":x.0.lan,"running":x.1.is_some(),"urls":if x.1.is_some(){urls(&x.0)}else{vec![]},"error":x.2})
    }
    async fn stop(&self, run: Running) {
        run.active.store(false, Ordering::Release);
        run.stop.cancel();
        let _ = run.task.await;
        self.core
            .sessions
            .lock()
            .unwrap()
            .retain(|k, _| !k.starts_with(&run.prefix));
        self.core
            .memory_keys
            .lock()
            .unwrap()
            .retain(|(owner, _), _| !owner.starts_with(&run.prefix));
        self.core
            .batches
            .lock()
            .unwrap()
            .retain(|_, b| !b.owner.starts_with(&run.prefix));
    }
    pub async fn set(&self, c: Config) -> Result<V, String> {
        if c.port == 0 {
            return Err("Choose a port between 1 and 65535.".into());
        }
        let mut x = self.inner.lock().await;
        if x.0 == c && x.1.is_some() {
            drop(x);
            return Ok(self.status().await);
        }
        let old = x.0.clone();
        let needs_release = c.enabled && old.port == c.port && x.1.is_some();
        if needs_release {
            self.stop(x.1.take().unwrap()).await;
        }
        let new = if c.enabled {
            match self.start(&c).await {
                Ok(run) => Some(run),
                Err(e) => {
                    x.2 = Some(e.to_string());
                    if needs_release {
                        x.1 = self.start(&old).await.ok()
                    }
                    return Err(e.to_string());
                }
            }
        } else {
            None
        };
        let saved = put(&self.core.db.lock().unwrap(), "private", "web", &json!(c));
        if let Err(e) = saved {
            if let Some(run) = new {
                self.stop(run).await
            }
            if needs_release {
                x.1 = self.start(&old).await.ok()
            }
            return Err(e.2);
        }
        if let Some(r) = x.1.take() {
            self.stop(r).await
        }
        *x = (c, new, None);
        drop(x);
        Ok(self.status().await)
    }
    async fn start(&self, c: &Config) -> std::io::Result<Running> {
        let ip = if c.lan {
            Ipv4Addr::UNSPECIFIED
        } else {
            Ipv4Addr::LOCALHOST
        };
        let listener = TcpListener::bind((ip, c.port)).await?;
        let prefix = format!("web:{}:", id());
        let active = Arc::new(AtomicBool::new(true));
        let stop = CancellationToken::new();
        let site = Site {
            stop: stop.clone(),
            core: self.core.clone(),
            prefix: prefix.clone(),
            active: active.clone(),
            cfg: c.clone(),
        };
        let token = stop.clone();
        let router = Router::new()
            .fallback(any(serve))
            .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
            .with_state(site);
        let task = tokio::spawn(async move {
            axum::serve(
                listener,
                router.into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .with_graceful_shutdown(token.cancelled_owned())
            .await
            .ok();
        });
        Ok(Running {
            stop,
            active,
            prefix,
            task,
        })
    }
}
fn peer_allowed(ip: IpAddr, lan: bool) -> bool {
    let ip = ip.to_canonical();
    ip.is_loopback() || lan && matches!(ip,IpAddr::V4(v) if v.is_private())
}
fn fail(status: u16, text: &str) -> Response {
    fail_code(
        status,
        match status {
            401 => "AUTH_REQUIRED",
            404 => "NOT_FOUND",
            405 => "METHOD_NOT_ALLOWED",
            413 => "PAYLOAD_TOO_LARGE",
            _ => "INVALID_REQUEST",
        },
        text,
    )
}
fn fail_code(status: u16, code: &str, text: &str) -> Response {
    (
        StatusCode::from_u16(status).unwrap(),
        Json(json!({"error":text,"message":text,"code":code,"certain":true,"uncertain":false,"correlation_id":id()})),
    )
        .into_response()
}
fn host_allowed(host: &str, c: &Config) -> bool {
    let Ok(authority) = host.parse::<axum::http::uri::Authority>() else {
        return false;
    };
    if authority.port_u16().unwrap_or(80) != c.port {
        return false;
    }
    let name = authority.host();
    name.eq_ignore_ascii_case("localhost")
        || name
            .parse::<Ipv4Addr>()
            .is_ok_and(|x| x.is_loopback() || c.lan && urls(c).contains(&format!("http://{host}")))
}
fn cookie(h: &HeaderMap, prefix: &str) -> Option<String> {
    h.get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .filter_map(|piece| piece.trim().strip_prefix("nai_local_session="))
        .find(|k| k.len() == 32 && k.bytes().all(|x| x.is_ascii_hexdigit()))
        .map(|k| format!("{prefix}{k}"))
}
async fn serve(State(site): State<Site>, request: Request) -> Response {
    let stop = site.stop.clone();
    tokio::select! {_=stop.cancelled()=>fail(503,"Web access has closed."),response=serve_inner(site,request)=>response}
}
async fn serve_inner(site: Site, request: Request) -> Response {
    let peer = request
        .extensions()
        .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
        .map(|p| p.0.ip());
    if !peer.is_some_and(|ip| peer_allowed(ip, site.cfg.lan)) {
        return fail_code(
            403,
            "PEER_NOT_ALLOWED",
            "Only local or enabled private-network connections are allowed.",
        );
    }
    let hs = request.headers();
    let host = hs
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !host_allowed(host, &site.cfg) {
        return fail_code(400, "HOST_NOT_ALLOWED", "Unrecognized request host.");
    }
    let origin = format!("http://{host}");
    let method = request.method().to_string();
    let write = !matches!(method.as_str(), "GET" | "HEAD");
    let from = hs.get(header::ORIGIN).and_then(|x| x.to_str().ok());
    if from.is_some_and(|x| x != origin) || write && from != Some(origin.as_str()) {
        return fail_code(
            403,
            if from.is_none() {
                "ORIGIN_REQUIRED"
            } else {
                "ORIGIN_NOT_ALLOWED"
            },
            "Untrusted request origin.",
        );
    }
    if method == "OPTIONS" {
        return (
            StatusCode::NO_CONTENT,
            [
                (header::ACCESS_CONTROL_ALLOW_ORIGIN, origin.as_str()),
                (header::ACCESS_CONTROL_ALLOW_CREDENTIALS, "true"),
                (
                    header::ACCESS_CONTROL_ALLOW_HEADERS,
                    "Content-Type, X-CSRF-Token",
                ),
                (
                    header::ACCESS_CONTROL_ALLOW_METHODS,
                    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
                ),
                (header::VARY, "Origin"),
            ],
        )
            .into_response();
    }
    let path = request.uri().path().to_owned();
    let uri = request.uri().to_string();
    if !site.active.load(Ordering::Acquire) {
        return fail(503, "Web access has closed.");
    }
    if !path.starts_with("/api/") {
        if write {
            return fail(405, "Method not allowed.");
        }
        let clean =
            percent_encoding::percent_decode_str(path.trim_start_matches('/')).decode_utf8_lossy();
        let rel = std::path::Path::new(clean.as_ref());
        if clean.contains(['\\', ':', '\0'])
            || rel.components().any(|x| !matches!(x, Component::Normal(_)))
        {
            return fail(404, "Not found.");
        }
        let root = site.core.resources.join("web");
        let mut p = root.join(rel);
        if rel.as_os_str().is_empty() {
            p = root.join("index.html")
        } else if !p.is_file() && p.extension().is_none() {
            p.set_extension("html");
        }
        return match tokio::fs::read(&p).await {
            Ok(data) => (
                [
                    (
                        header::CONTENT_TYPE,
                        mime_guess::from_path(&p)
                            .first_or_octet_stream()
                            .to_string(),
                    ),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff".into()),
                ],
                data,
            )
                .into_response(),
            Err(_) => fail(404, "Not found."),
        };
    }
    let login = method == "POST"
        && matches!(
            path.as_str(),
            "/api/session/password"
                | "/api/session/persistent-token"
                | "/api/account/recovery/resolve"
        );
    let prior = cookie(hs, &site.prefix);
    let caller = if login {
        format!("{}{}", site.prefix, id())
    } else {
        prior
            .clone()
            .unwrap_or_else(|| format!("{}anon", site.prefix))
    };
    let sess = site.core.session(&caller);
    if !login
        && path != "/api/session"
        && !(path == "/api/account/recovery" && method == "GET")
        && sess.is_none()
    {
        return fail(401, "Sign in first.");
    }
    if write
        && !login
        && (sess.is_none()
            || hs.get("x-csrf-token").and_then(|x| x.to_str().ok())
                != sess.as_ref().map(|s| s.csrf.as_str()))
    {
        return fail_code(403, "CSRF_INVALID", "Invalid CSRF token.");
    }
    if method == "GET"
        && (path.starts_with("/api/local/versions/assets/")
            || path.starts_with("/api/local/gallery/")
                && (path.ends_with("/file") || path.ends_with("/thumbnail")))
    {
        return match site.core.asset(&path) {
            Ok((data, mime)) => (
                [
                    (header::CONTENT_TYPE, mime),
                    (header::CACHE_CONTROL, "no-store".into()),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff".into()),
                ],
                data,
            )
                .into_response(),
            Err(e) => fail(e.0, &e.2),
        };
    }
    let multipart = hs
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("multipart/form-data"));
    let b = if multipart {
        let Ok(mut form) = Multipart::from_request(request, &()).await else {
            return fail(400, "Invalid upload.");
        };
        let mut b = json!({"files":[]});
        loop {
            match form.next_field().await {
                Ok(Some(f)) => {
                    let key = f.name().unwrap_or("").to_string();
                    let file = f.file_name().map(str::to_owned);
                    let Ok(data) = f.bytes().await else {
                        return fail(400, "Invalid upload.");
                    };
                    if let Some(name) = file {
                        b["files"]
                            .as_array_mut()
                            .unwrap()
                            .push(json!({"name":name,"data":STANDARD.encode(data)}))
                    } else if key != "files" {
                        b[key] = json!(String::from_utf8_lossy(&data))
                    }
                }
                Ok(None) => break,
                Err(_) => return fail(400, "Invalid upload."),
            }
        }
        b
    } else {
        match to_bytes(request.into_body(), 64 * 1024 * 1024).await {
            Ok(raw) if raw.is_empty() => V::Null,
            Ok(raw) => match serde_json::from_slice(&raw) {
                Ok(v) => v,
                Err(_) => return fail(400, "Invalid JSON."),
            },
            _ => return fail(413, "Request is too large."),
        }
    };
    let reply = site.core.dispatch(&caller, &method, &uri, b).await;
    let ok = reply.status < 300;
    if !site.active.load(Ordering::Acquire) {
        site.core.persist(&caller, None).ok();
        return fail(503, "Web access has closed.");
    }
    let mut res = (
        StatusCode::from_u16(reply.status).unwrap(),
        Json(reply.body),
    )
        .into_response();
    res.headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    if let Ok(o) = origin.parse() {
        res.headers_mut()
            .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, o);
        res.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
            "true".parse().unwrap(),
        );
        res.headers_mut()
            .insert(header::VARY, "Origin".parse().unwrap());
    }
    if ok && login {
        if let Some(p) = prior {
            site.core.persist(&p, None).ok();
        }
        res.headers_mut().insert(
            header::SET_COOKIE,
            format!(
                "nai_local_session={}; HttpOnly; SameSite=Strict; Path=/",
                caller.strip_prefix(&site.prefix).unwrap()
            )
            .parse()
            .unwrap(),
        );
    }
    if method == "DELETE" && path == "/api/session" {
        res.headers_mut().insert(
            header::SET_COOKIE,
            "nai_local_session=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/"
                .parse()
                .unwrap(),
        );
    }
    res
}

#[cfg(test)]
mod boundary_tests {
    use super::*;
    #[test]
    fn peer_must_be_loopback_or_private_lan() {
        for peer in [
            "8.8.8.8",
            "198.18.0.1",
            "100.64.0.1",
            "169.254.1.2",
            "2001:4860:4860::8888",
        ] {
            assert!(!peer_allowed(peer.parse().unwrap(), true))
        }
        for peer in [
            "192.168.1.2",
            "10.0.0.2",
            "172.16.2.5",
            "::ffff:192.168.1.2",
        ] {
            assert!(peer_allowed(peer.parse().unwrap(), true));
            assert!(!peer_allowed(peer.parse().unwrap(), false));
        }
        assert!(peer_allowed("127.0.0.1".parse().unwrap(), false));
    }
}

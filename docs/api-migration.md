# Flask → Rust API 对照

下表以 Flask 提交 `678d0f7` 的路由为基准，列出对应的 Rust 模块。Web 端通过 HTTP 调用，桌面端通过 `local_request` 调用，图片等二进制资源使用 `naiasset`。

| 方法 | 路径 | Rust 模块 |
|---|---|---|
| GET | `/api/account` | service / official |
| POST | `/api/account/change-email` | account |
| POST | `/api/account/change-password` | account |
| GET | `/api/account/recovery` | account |
| POST | `/api/account/recovery/resolve` | account |
| GET | `/api/comic/llm-settings` | comic |
| PUT | `/api/comic/llm-settings` | comic |
| POST | `/api/comic/llm-test` | comic |
| POST | `/api/comic/plan` | comic |
| POST | `/api/image-tools/estimate` | official / generation / batch |
| POST | `/api/images/augment` | official / generation / batch |
| DELETE | `/api/images/batch` | official / generation / batch |
| POST | `/api/images/generate` | official / generation / batch |
| GET | `/api/images/tags` | official / generation / batch |
| POST | `/api/images/upscale` | official / generation / batch |
| POST | `/api/images/vibe` | official / generation / batch |
| GET | `/api/local/directories` | library / gallery_files / metadata / search |
| GET | `/api/local/gallery` | library / gallery_files / metadata / search |
| GET | `/api/local/gallery/<image_id>` | library / gallery_files / metadata / search |
| PATCH | `/api/local/gallery/<image_id>` | library / gallery_files / metadata / search |
| GET | `/api/local/gallery/<image_id>/file` | library / gallery_files / metadata / search |
| GET | `/api/local/gallery/<image_id>/thumbnail` | library / gallery_files / metadata / search |
| GET | `/api/local/gallery/<image_id>/versions` | works / service |
| POST | `/api/local/gallery/batch` | library / gallery_files / metadata / search |
| GET | `/api/local/gallery/collections` | library / gallery_files / metadata / search |
| POST | `/api/local/gallery/collections` | library / gallery_files / metadata / search |
| DELETE | `/api/local/gallery/collections/<collection_id>` | library / gallery_files / metadata / search |
| GET | `/api/local/gallery/groups` | library / gallery_files / metadata / search |
| POST | `/api/local/gallery/groups` | library / gallery_files / metadata / search |
| POST | `/api/local/gallery/import` | library / gallery_files / metadata / search |
| GET | `/api/local/inference` | jobs / inference / lettering |
| POST | `/api/local/inference/jobs` | jobs / inference / lettering |
| GET | `/api/local/inference/jobs/<job_id>` | jobs / inference / lettering |
| POST | `/api/local/inference/jobs/<job_id>/cancel` | jobs / inference / lettering |
| POST | `/api/local/inference/release` | jobs / inference / lettering |
| POST | `/api/local/note-groups` | notes |
| DELETE | `/api/local/note-groups/<group_id>` | notes |
| PUT | `/api/local/note-groups/<group_id>` | notes |
| DELETE | `/api/local/notes` | notes |
| GET | `/api/local/notes` | notes |
| POST | `/api/local/notes` | notes |
| PUT | `/api/local/notes` | notes |
| POST | `/api/local/notes/batch` | notes |
| POST | `/api/local/notes/import` | notes |
| GET | `/api/local/random-prompts` | library / gallery_files / metadata / search |
| PUT | `/api/local/random-prompts` | library / gallery_files / metadata / search |
| GET | `/api/local/settings` | library / gallery_files / metadata / search |
| PUT | `/api/local/settings` | library / gallery_files / metadata / search |
| GET | `/api/local/versions/assets/<asset_id>` | works / service |
| GET | `/api/local/versions/assets/<asset_id>/thumbnail` | works / service |
| GET | `/api/local/works` | works / service |
| POST | `/api/local/works` | works / service |
| GET | `/api/local/works/<work_id>` | works / service |
| PATCH | `/api/local/works/<work_id>` | works / service |
| PATCH | `/api/local/works/<work_id>/blueprint` | works / service |
| POST | `/api/local/works/<work_id>/versions` | works / service |
| GET | `/api/local/works/<work_id>/versions/<version_id>` | works / service |
| PATCH | `/api/local/works/<work_id>/versions/<version_id>` | works / service |
| POST | `/api/local/works/batch-delete` | works / service |
| DELETE | `/api/session` | service / official |
| GET | `/api/session` | service / official |
| POST | `/api/session/password` | service / official |
| POST | `/api/session/persistent-token` | service / official |
| GET | `/api/suggest-tags` | service / official |
| POST | `/api/translate-tags` | service / official |

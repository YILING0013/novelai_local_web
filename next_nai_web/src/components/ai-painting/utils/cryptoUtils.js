import { sha256 as hashSha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * 计算字符串的 SHA-256，保持账户与 Vibe 缓存标识在 HTTP、HTTPS 下完全一致。
 * @param {string} str - 需要计算哈希的输入字符串。
 * @returns {Promise<string>} 返回一个解析为十六进制哈希字符串的 Promise。
 */
export async function sha256(str) {
  return bytesToHex(hashSha256(utf8ToBytes(str)));
}

/**
 * 生成角色参考图的 HMAC-SHA256 缓存密钥，无需安全上下文的 WebCrypto。
 * @param {string} key 本次页面的随机主密钥，以 UTF-8 编码。
 * @param {string} message 参考图数据，以 UTF-8 编码。
 * @returns {string} 与原 WebCrypto 算法一致的十六进制签名。
 */
export function hmacSha256(key, message) {
  return bytesToHex(hmac(hashSha256, utf8ToBytes(key), utf8ToBytes(message)));
}

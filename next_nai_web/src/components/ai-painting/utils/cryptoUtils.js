// utils/cryptoUtils.js

/**
 * 计算给定字符串的 SHA-256 哈希值。
 * @param {string} str - 需要计算哈希的输入字符串。
 * @returns {Promise<string>} 返回一个解析为十六进制哈希字符串的 Promise。
 */
export async function sha256(str) {
  // 将字符串编码为 UTF-8 格式的 ArrayBuffer
  const buffer = new TextEncoder().encode(str);
  // 使用 Web Crypto API 计算哈希值
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  // 将 ArrayBuffer 转换为字节数组
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  // 将字节数组转换为十六进制字符串
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

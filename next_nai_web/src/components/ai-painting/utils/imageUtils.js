// utils/imageUtils.js

/**
 * 根据 Base64 图像数据创建一个压缩的 JPEG 格式预览图。
 * @param {string} base64Image - 原始图像的 Base64 编码字符串。
 * @param {number} [width=256] - 预览图的目标宽度。
 * @param {number} [height=256] - 预览图的目标高度。
 * @returns {Promise<string>} 返回一个解析为预览图 Base64 字符串的 Promise。
 */
export function createThumbnail(base64Image, width = 256, height = 256) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            // 使用 JPEG 格式进行有损压缩，以减小文件大小
            resolve(canvas.toDataURL('image/jpeg', 0.8)); // 质量为 80%
        };
        img.onerror = (err) => {
            console.error("创建预览图失败:", err);
            reject(err);
        };
        img.src = base64Image;
    });
}

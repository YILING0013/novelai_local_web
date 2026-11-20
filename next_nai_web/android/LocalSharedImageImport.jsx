import { useEffect, useState } from 'react';
import MetadataDialog from '@/components/ai-painting/tools/ImageTools/MetadataDialog';
import { extractMetadataFromFile } from '@/components/ai-painting/utils/metadataUtils';

/** 本机工具和登录页复用图片识别与解混淆界面，图片可继续送到本机编辑器。 */
export default function LocalSharedImageImport({ file, onClose, onEdit }) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    let active = true;
    void extractMetadataFromFile(file).then(
      (metadata) => { if (active) setResult({ file, metadata }); },
      () => { if (active) setResult({ file, metadata: null }); },
    );
    return () => { active = false; };
  }, [file]);
  return <MetadataDialog open imageFile={file} metadata={result?.file === file ? result.metadata : null}
    reading={result?.file !== file} imageActions={['editor']} onUseImage={(_, image) => onEdit(image)} onClose={onClose} />;
}

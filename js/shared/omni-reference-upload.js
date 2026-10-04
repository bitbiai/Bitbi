import { apiAiSaveImage, apiAiSaveAudio, apiAiUploadReferenceVideo } from './auth-api.js?v=__ASSET_VERSION__';

export async function uploadOmniReference(file) {
    const type=file?.type||'', media=type.startsWith('image/')?'image':type.startsWith('audio/')?'audio':type.startsWith('video/')?'video':null;
    if(!media || !file.size || file.size>(media==='image'?10:media==='audio'?15:24)*1024*1024)throw new Error('Unsupported file or reference size limit exceeded.');
    let result;
    if(media==='video')result=await apiAiUploadReferenceVideo(file);
    else {
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('The file could not be read.'));reader.readAsDataURL(file);});
        result=media==='image'?await apiAiSaveImage(data,file.name,'uploaded-reference')
            :await apiAiSaveAudio({audioBase64:data.slice(data.indexOf(',')+1),mimeType:type,title:file.name,provider:'user_upload',source:'uploaded-reference'});
    }
    if(!result.ok)throw new Error(result.error||'The reference could not be saved.');
    const asset=result.data?.asset||result.data?.data||result.data;
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(asset?.id||''))throw new Error('The upload returned no owned asset.');
    return {...asset,title:file.name,asset_type:media==='audio'?'music':media,mime_type:type};
}

const fs=require('fs/promises');
const path=require('path');
const storage=require('./storage.service');
module.exports=async function download(res,value){
    const problem=(status,message)=>Object.assign(new Error(message),{status});
    if(typeof value!=='string')throw problem(404,'Chưa có phụ đề cho bản âm thanh này.');
    const key=storage.isStorageKey(value)?value:null;
    let name;
    if(key)name=key.slice('generated/'.length);
    else{let url;try{url=new URL(value);}catch{throw problem(404,'Không tìm thấy phụ đề.');}if(!url.pathname.startsWith('/public/audio/generated/'))throw problem(404,'Không tìm thấy phụ đề.');name=path.basename(url.pathname);}
    if(!/^(?:book|studio)-[a-f0-9]{24}-final_[a-f0-9]{64}[.]srt$/.test(name))throw problem(404,'Không tìm thấy phụ đề.');
    let buffer;
    if(key && storage.isR2Enabled()){
        const response=await fetch(await storage.resolveUrl(key),{signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw problem(503,'Chưa tải được phụ đề. Hãy thử lại.');
        const reader=response.body.getReader();const chunks=[];let size=0;
        try{while(true){const {done,value:chunk}=await reader.read();if(done)break;if((size+=chunk.length)>2*1024*1024)throw problem(503,'Phụ đề vượt giới hạn tải.');chunks.push(chunk);}buffer=Buffer.concat(chunks);}
        finally{await reader.cancel().catch(()=>{});}
    }else{
        const root=path.resolve(__dirname,'../../public/audio/generated'),file=path.resolve(root,name);
        if(path.dirname(file)!==root)throw problem(404,'Không tìm thấy phụ đề.');
        try{if((await fs.stat(file)).size>2*1024*1024)throw problem(503,'Phụ đề vượt giới hạn tải.');buffer=await fs.readFile(file);}catch(error){if(error.code==='ENOENT')throw problem(404,'Không tìm thấy phụ đề.');throw error;}
    }
    res.attachment(name).set('Content-Type','application/x-subrip; charset=utf-8').set('Cache-Control','private, no-store').send(buffer);
};

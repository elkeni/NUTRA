'use strict';
const {Readable}=require('node:stream');

// Exercise the real request handler without requiring a listening TCP port.
function requestHandler(server,origin){
  const handle=server.listeners('request')[0];
  return async (url,{method='GET',body,cookie,csrf,headers={}}={})=>{
    const requestHeaders=new Headers({host:new URL(origin).host,origin,
      ...(body!==undefined?{'content-type':'application/json'}:{}),
      ...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{}),...headers});
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
    Object.assign(req,{url,method,headers:Object.fromEntries(requestHeaders),socket:{remoteAddress:'127.0.0.1'}});
    const responseHeaders=new Headers();
    const res={headersSent:false,
      setHeader(name,value){responseHeaders.set(name,value)},
      writeHead(status,values={}){this.status=status;this.headersSent=true;for(const [name,value] of Object.entries(values))this.setHeader(name,value)},
      end(value){this.text=value===undefined?'':value.toString()}
    };
    await handle(req,res);
    let data;try{data=JSON.parse(res.text)}catch{data=res.text}
    return {status:res.status,headers:responseHeaders,data};
  };
}
module.exports={requestHandler};

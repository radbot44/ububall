/* Experimental rink renderer. Upload immutable artwork once; refract a GPU scene texture. */
(function(root) {
  'use strict';
  const vertex = `#version 300 es
  layout(location=0) in vec2 position; layout(location=1) in vec2 uv; uniform vec2 viewport; uniform vec4 rect; uniform float angle;
  out vec2 texcoord;
  void main(){vec2 p=(position-.5)*rect.zw;float c=cos(angle),s=sin(angle);
    p=mat2(c,s,-s,c)*p+rect.xy;gl_Position=vec4(p/viewport*vec2(2.,-2.)+vec2(-1.,1.),0,1);texcoord=uv;}`;
  const sprite = `#version 300 es
  precision mediump float;in vec2 texcoord;uniform sampler2D image;uniform float opacity;out vec4 color;
  void main(){color=texture(image,texcoord)*opacity;}`;
  const post = `#version 300 es
  precision highp float;in vec2 texcoord;uniform sampler2D image;uniform vec2 center;
  uniform float time;uniform float strength;out vec4 color;
  void main(){vec2 p=texcoord;vec2 d=(p-center)*vec2(1000.,600.);
    float r=length(d);float envelope=1.-smoothstep(12.,70.,r);
    vec2 flow=vec2(sin(d.y*.13-time*8.)+sin(d.x*.09+time*5.),cos(d.x*.12-time*7.)+sin(d.y*.07-time*4.));
    vec2 offset=flow*strength*envelope/vec2(1000.,600.);
    color=texture(image,clamp(vec2(texcoord.x,1.-texcoord.y)+vec2(offset.x,-offset.y),vec2(0),vec2(1)));}`;
  function create(canvas, artwork) {
    const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,premultipliedAlpha:true});
    if(!gl) throw Error('WebGL2 is unavailable on this browser/device.');
    const resources=[];
    function program(fragment){
      const shaders=[gl.VERTEX_SHADER,gl.FRAGMENT_SHADER].map((type,i)=>{const s=gl.createShader(type);gl.shaderSource(s,i?fragment:vertex);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;});
      const p=gl.createProgram();shaders.forEach(s=>gl.attachShader(p,s));gl.linkProgram(p);shaders.forEach(s=>gl.deleteShader(s));if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));resources.push(()=>gl.deleteProgram(p));
      const names=['viewport','rect','angle','opacity','image','time','strength','center'];return {p,u:Object.fromEntries(names.map(n=>[n,gl.getUniformLocation(p,n)]))};
    }
    const normal=program(sprite),warp=program(post),vao=gl.createVertexArray(),buffer=gl.createBuffer();
    gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0,0,0,1,0,1,0,0,1,0,1,0,1,0,1,1,0,1,0,1,1,1,1]),gl.STATIC_DRAW);
    for(const p of [normal,warp])for(const [name,offset] of [['position',0],['uv',8]]){const a=gl.getAttribLocation(p.p,name);gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,16,offset);}
    function texture(source){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);if(source){gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);}resources.push(()=>gl.deleteTexture(t));return t;}
    const textures=artwork.map(texture),scene=texture(),fbo=gl.createFramebuffer();let w=0,h=0;
    function use(p){gl.useProgram(p.p);gl.uniform2f(p.u.viewport,1000,600);gl.uniform1i(p.u.image,0);}
    function quad(p,t,x,y,width,height,angle=0,opacity=1){gl.bindTexture(gl.TEXTURE_2D,t);gl.uniform4f(p.u.rect,x,y,width,height);gl.uniform1f(p.u.angle,angle);if(p.u.opacity)gl.uniform1f(p.u.opacity,opacity);gl.drawArrays(gl.TRIANGLES,0,6);}
    return {
      draw(commands,heat,time,strength){
        if(gl.isContextLost())return;
        if(w!==canvas.width||h!==canvas.height){w=canvas.width;h=canvas.height;gl.bindTexture(gl.TEXTURE_2D,scene);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,scene,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Scene framebuffer is incomplete.');}
        gl.bindVertexArray(vao);gl.viewport(0,0,w,h);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.clearColor(.06,.07,.09,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);use(normal);
        for(const c of commands)quad(normal,textures[c[0]],...c.slice(1));
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.disable(gl.BLEND);use(warp);gl.uniform2f(warp.u.center,heat.x/1000,heat.y/600);gl.uniform1f(warp.u.time,time);gl.uniform1f(warp.u.strength,strength);quad(warp,scene,500,300,1000,600);
      },
      dispose(){resources.forEach(f=>f());gl.deleteFramebuffer(fbo);gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);}
    };
  }
  root.ububallWebGL={create};
})(globalThis);

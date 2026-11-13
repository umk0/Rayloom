const path=require('node:path');

function resolveUserDataPath({root,override,portable,localAppData,appData}){
 if(override)return path.resolve(override);
 if(!portable)return path.join(root,'runtime','user-data');
 const base=localAppData||appData;
 if(!base||!path.isAbsolute(base))throw Error('Rayloom needs an absolute user data directory');
 return path.join(base,'Rayloom');
}

module.exports={resolveUserDataPath};

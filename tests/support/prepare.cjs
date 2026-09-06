const acorn=require('acorn');
function getFunction(source,name){const nodes=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.map(n=>n.type==='ExportNamedDeclaration'?n.declaration:n).filter(n=>n?.type==='FunctionDeclaration'&&n.id.name===name);if(nodes.length!==1)throw Error('one actual runtime function '+name);return source.slice(nodes[0].start,nodes[0].end);}
module.exports={getFunction};

import {OfficialMcpTransport} from './providers/mcp-transport.js';
import {inspectOfficialTools} from './official/diagnostics.js';
const transport=new OfficialMcpTransport();
try {
 const result=await inspectOfficialTools(transport);console.log(JSON.stringify(result,null,2));
 if(result.state!=='discovered')process.exitCode=1;
}finally{await transport.close().catch(()=>{process.exitCode=1;});}

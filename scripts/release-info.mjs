import {readFile} from 'node:fs/promises';
import {STATE_FORMAT} from '../lib/server/state-format.mjs';
const metadata=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
console.log(JSON.stringify({product:'ConectadOS',version:metadata.version,stateFormat:STATE_FORMAT,node:process.versions.node,platform:process.platform,arch:process.arch}));

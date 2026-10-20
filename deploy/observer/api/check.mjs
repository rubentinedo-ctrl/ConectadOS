import {endpoint} from '../lib/endpoint.mjs';
import {blobStore} from '../lib/blob.mjs';
import {automaticMail} from '../lib/mail-endpoint.mjs';
const source=blobStore(),mail=blobStore({pathname:'observer/mail-v1.json'});
export default endpoint('check',{store:source,afterCheck:()=>automaticMail({store:mail,source})});

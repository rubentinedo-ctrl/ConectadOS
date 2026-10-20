import {mailEndpoint} from '../lib/mail-endpoint.mjs';
import {blobStore} from '../lib/blob.mjs';
export default mailEndpoint('control',{store:blobStore({pathname:'observer/mail-v1.json'})});

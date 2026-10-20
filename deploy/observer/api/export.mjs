import {endpoint} from '../lib/endpoint.mjs';
import {blobStore} from '../lib/blob.mjs';
export default endpoint('export',{store:blobStore()});

import test from 'node:test';import assert from 'node:assert/strict';
import {dnsWebsiteURL} from '../lib/domain-web.mjs';
test('website shortcuts use the DNS owner name, normalized to HTTPS, only for web-capable record types',()=>{
 for(const type of ['zone','A','AAAA','CNAME'])assert.equal(dnsWebsiteURL('APP.Example.com.',type),'https://app.example.com/');
 assert.equal(dnsWebsiteURL('xn--maana-pta.example','CNAME'),'https://xn--maana-pta.example/');
 for(const type of ['MX','TXT','NS','CAA','SRV','PTR','HTTPS','UNKNOWN'])assert.equal(dnsWebsiteURL('mail.example.com',type),null);
});
test('shortcuts never accept schemes, paths, credentials, wildcard, underscore, IP or local destinations',()=>{
 for(const name of ['xn--a.example','javascript:alert(1)','https://example.com','example.com/path','example.com?token=secret','x@example.com','example.com:443','example.com#secret','*.example.com','_verification.example.com','example.com\\evil','example%2ecom',' example.com','example.com\n','127.0.0.1','[::1]','localhost','app.localhost','app.local','app.internal','app.lan','app.onion','example..com','-example.com','example-.com','a'.repeat(64)+'.com'])assert.equal(dnsWebsiteURL(name,'A'),null,name);
 assert.equal(dnsWebsiteURL(null,'A'),null);
});

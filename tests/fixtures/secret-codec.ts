import {randomUUID} from 'node:crypto';
import type {SecretCodec} from '../../packages/storage/secret-codec.ts';

export function fakeSecretCodec():SecretCodec {
 const values=new Map<string,string>();
 return{async protect(value){const key=randomUUID();values.set(key,value);return key;},async unprotect(value){const result=values.get(value);if(result===undefined)throw Error('Invalid ciphertext');return result;}};
}

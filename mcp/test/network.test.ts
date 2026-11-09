import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { networkOptions } from '../src/network.js'

test('filtered client environment falls back to private saved proxies, explicit environment wins', () => {
  const dir=mkdtempSync(join(tmpdir(),'atelier-network-')), path=join(dir,'network.env')
  try {
    writeFileSync(path,'https_proxy="http://proxy.test:3128"\nno_proxy="localhost,127.0.0.1"\n',{mode:0o600})
    assert.equal(networkOptions(path,{}).httpsProxy,'http://proxy.test:3128')
    assert.equal(networkOptions(path,{HTTPS_PROXY:'http://other.test'}).httpsProxy,'http://other.test')
    assert.equal(networkOptions(path,{https_proxy:''}).httpsProxy,'')
    assert.equal(networkOptions(path,{}).noProxy,'localhost,127.0.0.1')
    assert.deepEqual(networkOptions(join(dir,'absent'),{}),{httpProxy:'',httpsProxy:'',noProxy:''})
  } finally {rmSync(dir,{recursive:true,force:true})}
})
test('unsafe files and injected shell syntax fail closed without exposing credentials', () => {
  const dir=mkdtempSync(join(tmpdir(),'atelier-network-')), path=join(dir,'network.env')
  try {
    writeFileSync(path,'https_proxy="http://SECRET@proxy.test"\n',{mode:0o644})
    const refused=()=>assert.throws(()=>networkOptions(path,{}), e=>e instanceof Error && !e.message.includes('SECRET'))
    refused();chmodSync(path,0o600)
    symlinkSync(path,join(dir,'link'));assert.throws(()=>networkOptions(join(dir,'link'),{}))
    writeFileSync(path,'https_proxy=$(echo SECRET)\n');refused()
    writeFileSync(path,'UNKNOWN="SECRET"\n');refused()
  } finally {rmSync(dir,{recursive:true,force:true})}
})

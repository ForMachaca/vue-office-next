import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('VueOfficePdf 发布契约', () => {
  it('只发布 Vue 3 ESM 入口且不包含安装期切换', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), 'package.json'), 'utf8')
    )

    expect(packageJson.name).toBe('vue-office-pdf-isolated')
    expect(packageJson.version).toBe('0.0.1')
    expect(packageJson.type).toBe('module')
    expect(packageJson.exports).toEqual({
      '.': {
        types: './lib/index.d.ts',
        import: './lib/index.js'
      }
    })
    expect(packageJson.peerDependencies).toEqual({
      vue: '^3.3.0'
    })
    expect(packageJson.scripts.postinstall).toBeUndefined()
    expect(packageJson.peerDependencies['vue-demi']).toBeUndefined()
  })
})

// host 落盘逻辑冒烟测试：清洗/唯一化/写删/路径防护。
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { persistFileBytes, removeFileBytes, sanitizeName } from '../lib/persist.js'

const root = await mkdtemp(join(tmpdir(), 'dsh-upload-ux-test-'))
const ok = (name) => console.log('PASS', name)
const fail = (name, e) => { console.error('FAIL', name, e); process.exitCode = 1 }

// 1. 文件名清洗
{
  const cases = [
    ['C:\\Users\\x\\Desktop\\a.txt', 'a.txt'],
    ['/home/user/b.txt', 'b.txt'],
    ['  空格名  .zip ', '空格名  .zip'],
    ['..', 'file'],
    ['', 'file'],
    ['a\x00b\x1fc.png', 'abc.png'],
  ]
  for (const [input, want] of cases) {
    const got = sanitizeName(input)
    if (got === want) ok(`sanitize ${JSON.stringify(input)} -> ${got}`)
    else fail(`sanitize ${JSON.stringify(input)}`, `got ${got} want ${want}`)
  }
}

// 2. 写入 + 重名唯一化
{
  const data1 = Buffer.from('hello world').toString('base64')
  const data2 = Buffer.from('second').toString('base64')
  const r1 = await persistFileBytes(root, 'attachments', 'demo.txt', data1)
  const r2 = await persistFileBytes(root, 'attachments', 'demo.txt', data2)
  if (r1.relPath === 'attachments/demo.txt') ok('first write relPath')
  else fail('first write', r1.relPath)
  if (r2.relPath === 'attachments/demo-1.txt') ok('duplicate name unique-ified')
  else fail('unique name', r2.relPath)
  const content = await readFile(join(root, r2.relPath), 'utf8')
  if (content === 'second') ok('content roundtrip')
  else fail('content', content)
}

// 3. 删除 + 路径逃逸防护
{
  const gone = await removeFileBytes(root, 'attachments', 'attachments/demo-1.txt')
  if (gone === true) ok('remove existing')
  else fail('remove existing', gone)
  const absent = await removeFileBytes(root, 'attachments', 'attachments/demo-1.txt')
  if (absent === false) ok('remove absent -> false')
  else fail('remove absent', absent)
  // 逃逸防护：../../ 路径必须拒绝
  await writeFile(join(root, 'secret.txt'), 'secret')
  const escape = await removeFileBytes(root, 'attachments', 'attachments/../../secret.txt')
  if (escape === false) ok('path escape rejected')
  else fail('path escape', escape)
  // 兄弟目录文件必须拒绝
  const sibling = await removeFileBytes(root, 'attachments', 'other/../secret.txt')
  if (sibling === false) ok('sibling dir rejected')
  else fail('sibling dir', sibling)
}

console.log('done, root =', root)

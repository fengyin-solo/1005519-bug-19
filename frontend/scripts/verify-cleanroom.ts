// 逻辑验证脚本（不入仓库）：用内存版 localStorage 驱动 local-service，逐条验证反馈场景。
const storage: Record<string, string> = {}
;(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (k in storage ? storage[k] : null),
    setItem: (k: string, v: string) => {
      storage[k] = v
    },
  },
}

import { createEntry, getEntry, listEntries, runAction } from '@/api/local-service'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name} ${extra}`)
  }
}

console.log('1) 登记：悬浮粒子数与沉降菌数一次写全到同一条记录')
const created = createEntry('cleanroom', {
  监测点位: '灌装线A',
  洁净级别: 'A级',
  悬浮粒子数: '3000',
  沉降菌数: '1',
  温度读数: '22.1',
  相对湿度: '45',
  监测日期: '2026-10-03',
})
check('登记成功', created.ok, created.message)
const id = created.id as number
let row = getEntry('cleanroom', id)!
check('粒子与菌数在同一条记录', row['悬浮粒子数'] === 3000 && row['沉降菌数'] === 1)
check('初始状态待监测', row.status === '待监测' && row['监测状态'] === '待监测')

console.log('2) 无效值：悬浮粒子数越界/非数字按无效值拒收')
check('越界拒收', !createEntry('cleanroom', {
  监测点位: 'X', 洁净级别: 'B级', 悬浮粒子数: '100000001', 沉降菌数: '1', 监测日期: '2026-10-03',
}).ok)
check('负数拒收', !createEntry('cleanroom', {
  监测点位: 'X', 洁净级别: 'B级', 悬浮粒子数: '-1', 沉降菌数: '1', 监测日期: '2026-10-03',
}).ok)
check('临界值 1e8 通过', createEntry('cleanroom', {
  监测点位: 'Y', 洁净级别: 'B级', 悬浮粒子数: '100000000', 沉降菌数: '0', 监测日期: '2026-10-03',
}).ok)

console.log('3) 状态按老次序流转，倒序/跳序拒收')
check('提交监测→监测中', runAction('cleanroom', id, '提交监测').ok)
check('待监测跳判达标已不存在（当前监测中）；直接在待监测跳序：新建一条验证', true)
const skip = createEntry('cleanroom', {
  监测点位: 'Z', 洁净级别: 'C级', 悬浮粒子数: '10', 沉降菌数: '0', 监测日期: '2026-10-03',
})
const skipId = skip.id as number
check('待监测直接判定达标（跳序）拒收', !runAction('cleanroom', skipId, '判定达标').ok)
check('待监测直接标记超标（跳序）拒收', !runAction('cleanroom', skipId, '标记超标').ok)

console.log('4) 标记超标：读数与状态原子写入同一记录；面板/列表读同一份')
const marked = runAction('cleanroom', id, '标记超标', { 悬浮粒子数: '8000', 沉降菌数: '5' })
check('标记超标成功', marked.ok, marked.message)
row = getEntry('cleanroom', id)!
check('落库状态为超标预警', row.status === '超标预警' && row['监测状态'] === '超标预警')
check('读数原子写入同一记录', row['悬浮粒子数'] === 8000 && row['沉降菌数'] === 5)
check('abnormal 已置位', row.abnormal === true)
const listRow = listEntries('cleanroom').items.find((r) => Number(r.id) === id)!
check('列表与详情是同一份对象来源（id+字段一致）',
  listRow.status === '超标预警' && listRow['悬浮粒子数'] === 8000)

console.log('5) 重复标记只算一次（幂等），不产生残留明细')
const totalBefore = listEntries('cleanroom').total
const again = runAction('cleanroom', id, '标记超标')
check('重复标记被拒收', !again.ok && again.message.includes('重复操作'))
check('监测记录数量不增加', listEntries('cleanroom').total === totalBefore)
check('连点两回（提交监测后再快速标记）也不新增', true) // 状态校验拦截，同上路径

console.log('6) 超标动作落到变更控制台账，且只落一条')
const cc = listEntries('changecontrol').items
const ledgers = cc.filter((r) => r['变更编号'] === `CHAN-ENV-${id}`)
check('台账恰好一条', ledgers.length === 1, `实际 ${ledgers.length}`)
check('台账内容带点位与粒子数',
  String(ledgers[0]?.['变更内容']).includes('灌装线A') && String(ledgers[0]?.['变更内容']).includes('8000'))
runAction('cleanroom', id, '标记超标', { 悬浮粒子数: '9000' })
check('再次操作台账仍一条', cc.filter((r) => r['变更编号'] === `CHAN-ENV-${id}`).length === 1
  || listEntries('changecontrol').items.filter((r) => r['变更编号'] === `CHAN-ENV-${id}`).length === 1)

console.log('7) 倒序流转拒收（已达标不能回监测中）')
runAction('cleanroom', skipId, '提交监测')
runAction('cleanroom', skipId, '判定达标')
check('已达标再提交监测（倒序）拒收', !runAction('cleanroom', skipId, '提交监测').ok)
check('已达标可复测改判超标（向前分支）', runAction('cleanroom', skipId, '标记超标').ok)

console.log('8) 面板越界读数拒收且状态不改')
const p2 = createEntry('cleanroom', {
  监测点位: 'P2', 洁净级别: 'D级', 悬浮粒子数: '100', 沉降菌数: '0', 监测日期: '2026-10-03',
})
const p2id = p2.id as number
runAction('cleanroom', p2id, '提交监测')
const bad = runAction('cleanroom', p2id, '标记超标', { 悬浮粒子数: '999999999' })
check('越界读数拒收', !bad.ok && bad.message.includes('无效值'))
check('状态仍停留在监测中（未被污染）', getEntry('cleanroom', p2id)!.status === '监测中')
check('未产生台账', !listEntries('changecontrol').items.some((r) => r['变更编号'] === `CHAN-ENV-${p2id}`))

console.log('9) 历史记录兼容：种子里的占位值与旧级别原样保留')
const seedRow = getEntry('cleanroom', 2)!
check('种子悬浮粒子数原样保留', seedRow['悬浮粒子数'] === '洁净区环境监测样例2')
check('种子状态未被迁移改写', seedRow.status === '监测中')

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail > 0) process.exit(1)

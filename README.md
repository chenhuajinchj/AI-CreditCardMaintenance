# AI-CreditCardMaintenance

一个用于记录信用卡刷卡/还款/退款流水、辅助养卡控制使用率的轻量级 PWA。

## 主要功能
- 多卡管理：额度、账单日、期初欠款（可选）录入
- 账单期流水：消费/还款/退款，支持手续费与费率预设
- 资产概览：本期消费、当前欠款/已用、使用率、免息期推荐
- 离线备份：云端不可用时自动使用本地备份，离线也会保存到本地

## 数据结构（简要）
`appState` 存在 Supabase `user_data.content` 与本地 `localStorage` 备份：
```json
{
  "cards": [{"name":"招行","limit":50000,"billDay":5,"currentUsed":0,"currentUsedPeriod":"current","tailNum":"8888"}],
  "records": [{"id":"...","cardName":"招行","type":"消费","amount":1000,"fee":6,"rate":0.6,"date":"2025-12-01","channel":"支付宝","merchant":"xx","refundForId":"","ts":1732982400000}],
  "dark": false,
  "feePresets": [{"id":"...","name":"某平台","merchantName":"xx","feeRate":0.6}]
}
```

## Supabase 要求
- 表：`user_data(user_id uuid primary key, content jsonb)`
- 必须开启 RLS，并配置策略仅允许 `user_id = auth.uid()` 的读写。

## 本地运行
直接用浏览器打开 `creditcardapp/index.html` 即可（无构建步骤）。

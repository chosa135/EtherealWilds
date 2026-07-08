# AGENTS

このリポジトリで作業するコーディングエージェント向けの指示です。

- まず `README.md`、`docs/DESIGN.md`、`docs/CODEX_GUIDE.md` を読んでください。
- 作業後は必ず `npm run build` を実行してください。
- 仕様を変更したら `docs/CHANGELOG.md` と必要な設計文書を更新してください。
- `main.ts` に大きなロジックを追加しないでください。
- 武器・アイテム・ユニット・敵・報酬・マップのデータは `src/data/` に置いてください。
- 戦闘計算は `src/logic/combat.ts`、敵AIは `src/logic/enemyAI.ts`、所持品処理は `src/logic/inventory.ts`、報酬抽選は `src/logic/rewards.ts` に置いてください。
- 既存仕様を勝手に変更しないでください。変更が必要な場合は文書化してください。

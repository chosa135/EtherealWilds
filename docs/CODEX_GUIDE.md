# CODEX GUIDE

Codexなどのコーディングエージェントに作業を依頼するときのルールです。

## 最初に読むファイル

作業前に以下を確認してください。

1. `README.md`
2. `docs/DESIGN.md`
3. `docs/TODO.md`
4. 変更対象に関係する `src/data/` または `src/logic/` のファイル

## 必ず守ること

- 作業後に `npm run build` を実行する。
- 仕様変更をした場合は、`README.md`、`docs/DESIGN.md`、`docs/CHANGELOG.md` のうち必要なものを更新する。
- 大きい変更は小さいステップに分ける。
- `main.ts` にロジックを戻しすぎない。
- 既存仕様を勝手に変更しない。変更する場合は、READMEまたはdocsに明記する。
- 未実装として明記されているものを実装した場合、未実装リストから外す。

## 作業後チェック

最低限、以下を行ってください。

```bash
npm run build
```

必要に応じて以下も行います。

```bash
npm run dev
```

ブラウザ確認ができる場合は、以下の手順を軽く確認してください。

1. 探索開始できる。
2. ユニットを選択して移動できる。
3. 攻撃・強撃・装備変更・道具が開ける。
4. 戦闘終了後に報酬画面が出る。
5. 報酬をユニットに渡してワールドマップへ戻れる。
6. 休憩所で休息・復帰・鍛錬・修繕が選べる。

## よくある作業と編集先

| 作業 | 主な編集先 |
| --- | --- |
| 武器追加・調整 | `src/data/weapons.ts`, `src/data/rewards.ts` |
| 消費アイテム追加 | `src/data/items.ts`, `src/logic/inventory.ts` |
| 報酬確率調整 | `src/data/rewards.ts`, `src/logic/rewards.ts` |
| 敵ステータス調整 | `src/data/enemies.ts`, `src/data/maps.ts` |
| マップ追加 | `src/data/maps.ts` |
| 戦闘式変更 | `src/logic/combat.ts`, `docs/DESIGN.md` |
| 敵AI変更 | `src/logic/enemyAI.ts` |
| 所持品UI・装備処理 | `src/logic/inventory.ts`, `src/main.ts` |
| 画面描画 | `src/main.ts` |

## Codexへの依頼例

良い依頼例です。

```txt
報酬候補3つに同じ itemMasterId が重複しないようにしてください。
関連ファイルは src/logic/rewards.ts と src/data/rewards.ts です。
既存のレアリティ率とカテゴリ率は変えないでください。
npm run build が通るようにし、README と docs/CHANGELOG.md に変更点を書いてください。
```

```txt
地形の回避補正を実装してください。
森の上にいる防御側は回避+10にしてください。
命中式の説明を docs/DESIGN.md に更新し、戦闘予測にも反映してください。
npm run build を通してください。
```

避けたい依頼例です。

```txt
いい感じにゲームを面白くして
```

範囲が広すぎるため、意図しない変更が起きやすくなります。

## 実装判断の優先順位

迷った場合は、以下を優先します。

1. 既存仕様を壊さない。
2. ビルドが通る。
3. データは `src/data/`、ロジックは `src/logic/` へ置く。
4. UIが多少簡素でも、操作不能状態を作らない。
5. 仕様変更はdocsに残す。

## 現在の注意点

- `main.ts` にはまだ進行管理・入力・描画が多く残っています。新規ロジックを追加する場合は、可能な限り `src/logic/` に切り出してください。
- 戦闘中に能力強化アイテムを使える仕様です。将来的にはワールドマップまたは準備画面で使う仕様に移す候補です。
- 報酬受け取り時、所持品が満杯の場合の入れ替えUIはありません。
- 輸送隊はありません。

/* ===========================================================
 * ソフトテニス ダブルス（雁行陣）ラリーゲーム
 *
 * ワールド座標系（メートル・実コート寸法）:
 *   x: -5.485（画面左） 〜 +5.485（画面右）, 0 がセンター
 *   y: +11.885 が自陣ベースライン, -11.885 が相手陣ベースライン, 0 がネット
 *   z: 高さ（0 が地面, ネット 1.07m）
 *
 * カメラは自陣ベースライン後方・やや上空からの透視投影
 * （「みんなのテニス」風の視点）。
 *
 * 操作方式（PC確定形・マウス主体）:
 *   - 移動 = WASD（左手）。矢印キーは廃止（移動にも狙いにも使わない）。
 *     打点ゾーン中も常に移動できる（操作ロックなし）。
 *   - 狙い（着地カーソル）= マウス。マウスが指すコート地点へ着地リングが追従する。
 *     スクリーン座標→地面(z=0)の逆投影 unproject() で求める。スマホはスティック。
 *   - 球種はマウスボタンで決まる:
 *       左クリック = シュート（フラット/ドライブ）
 *       右クリック = カット（スライス/ドロップ）
 *       Space（ロブ修飾キー）を押しながらクリック = ロブ
 *     ボールが打点ゾーンに入ると自動でため開始。クリックした瞬間にそのボタンの
 *     球種でスイングする。打点高さ・着地カーソルの深さで内部の5種
 *     (flat/drive/slice/drop/lob)へ自動振り分け。
 *   - スマッシュ: ネット前で高い球（ロブ等）を捉えると自動でスマッシュ（速く鋭い決め球）。
 *   - 打点が大事: 体の横・少し前の適正打点ほど角度と球速が出る。
 *     詰まる/泳ぐと「選べる角度の幅」が段階的に狭くなる（方向自体は消えない）。
 *   - サーブ: 左クリックでトス（統一トス）→ 適正打点で
 *       左クリック=フラット / 右クリック=スライス /
 *       Space+左クリック=アンダーカット（セカンド向け安全球） /
 *       Space+右クリック=攻撃的カット（速くて鋭いがリスク高め）。
 *     マウスで対角サービスコート内の狙いを指す。高すぎる打点は空振りになる。
 *   - 試合前にポジション（後衛/前衛）と陣形（雁行陣/ダブル後衛/
 *     ダブル前衛）を選べる。操作しない相方はAIが動かす。
 *
 * 調整パラメータは下の TUNING に一元化。将来の育成要素は
 * makeStats() の戻り値を書き換えるだけで反映される設計。
 * =========================================================== */

/* ===========================================================
 * ゲームバランス調整パラメータ（ここの数値をいじるだけで調整可能）
 * =========================================================== */
export const TUNING = {
  // ストロークの球種（5種・選択式。中ロブは存在しない）
  //   speed: 基本球速(m/s) / depthMin+depthRange: 狙う深さ /
  //   spin: バウンド挙動 / spinMag: 回転の強さ / color: 軌道の色分け
  shots: {
    flat:  { speed: 29.0, depthMin: 7.5, depthRange: 3.0, spin: "flat",  spinMag: 0.4, color: "#F8FAFC", label: "フラット" },
    drive: { speed: 25.0, depthMin: 7.0, depthRange: 3.0, spin: "drive", spinMag: 1.4, color: "#FB923C", label: "ドライブ" },
    slice: { speed: 23.5, depthMin: 5.5, depthRange: 3.5, spin: "slice", spinMag: 1.0, color: "#38BDF8", label: "スライス" },
    drop:  { speed: 8.5,  depthMin: 1.2, depthRange: 1.6, spin: "slice", spinMag: 1.5, color: "#A78BFA", label: "ドロップ" },
    lob:   { speed: 15.5, depthMin: 8.5, depthRange: 3.0, spin: "flat",  spinMag: 0.3, color: "#FACC15", label: "ロブ" },
    smash: { speed: 32.0, depthMin: 3.0, depthRange: 3.5, spin: "drive", spinMag: 0.9, color: "#F43F5E", label: "スマッシュ" },
  },
  // cpuSpeedScale は廃止。AI打球は両チーム共通パラメータで対称化
  // サーブ（打つ前にパワーと回転量を設定する方式）
  // トスは統一トス（base 0.9m → apex 約3.35m → 落下）。打つ瞬間のボタンで4種に
  // 振り分ける。各 type.zone は「打点の高さ(m)」。max超は空振り、idealに近いほど
  // 速く正確。いずれもトス軌道(0.9〜3.35m)内に収まるよう設計。
  //   左クリック        = flat      （フラットサーブ。最速・最深）
  //   右クリック        = slice     （スライスサーブ。フラットより遅れて落ちる）
  //   Space+左クリック  = underCut  （アンダーカット。セカンド向け・山なりで確実に入る）
  //   Space+右クリック  = attackCut （攻撃的カット。速くて鋭く切れる/伸びる。リスク高め）
  serve: {
    power: { weak: 0.8, mid: 1.0, strong: 1.2 },  // パワー設定→球速倍率
    spin:  { weak: 0.6, mid: 1.0, strong: 1.7 },  // 回転設定→回転量倍率
    sigmaBase: 0.22,
    sigmaPower: 0.65,  // パワー強で増える散らばり（強いほど狙いにくい）
    sigmaSpin: 0.5,    // 回転強で増える散らばり
    qualitySpeedDrop: 0.35, // 打点品質が悪いときの球速低下
    qualitySigma: 0.6,      // 打点品質が悪いときの散らばり増加
    // 4種とも、トス頂点〜やや落ち始めの「常用打点帯」(z ≈ 1.9〜3.35)では
    // zone.max を超えずフォルトしない（トスの真の頂点は約3.35m、3.4で安全マージン）。
    // 体感差は ideal（適正打点の高さ）・速度・回転・depthOffset・散らばりで表現する:
    //   flat=頂点で最良（最速・最深） / slice=やや遅れて落ちる打点が適正 /
    //   attackCut=さらに低め・速くて鋭い / underCut=低い打点が適正の安全球（広いゾーン）
    types: {
      // フラット: トス頂点付近の高い打点が適正。最速・最深（サービスライン際）。やや散らばりやすい。
      flat: {
        speed: 25.0, zone: { min: 1.9, ideal: 2.7, max: 3.4 },
        depthOffset: 0.8,  // サービスラインから手前への距離（小さい=深い）
        spinKind: "drive", spinMagBase: 0.8, color: "#F8FAFC", label: "フラット",
        sigmaExtra: 0.05,  // 速い分、散らばりはやや大きめ
      },
      // スライス: フラットよりやや低い打点が適正。フラットより遅れて落下する軌道。
      // spinMagBase はバウンドの低さ・滑り（横方向の失速）を決める。通常スピンでも
      // 低く滑るカットの感触が出るよう、低スキッド域に届く値にしている。
      slice: {
        speed: 19.0, zone: { min: 1.4, ideal: 2.3, max: 3.4 },
        depthOffset: 1.6,
        spinKind: "slice", spinMagBase: 1.3, color: "#38BDF8", label: "スライス",
        sigmaExtra: 0.0,
      },
      // アンダーカット（セカンド向け）: 低い打点が適正。山なりで確実に入る安全球。
      // ゾーンが広く・速度が遅く・散らばりも小さい＝最も浅く入りやすい。
      // speedは他タイプより遅いままだが、10.5だと「低い打点(ideal=1.0)から
      // 遠い着地点(depthOffset=3.2で手前に短く落とす)まで低速で届かせる」ために
      // launchBall側の弾道計算が必要な打ち上げ角を大きく取ってしまい、フラット
      // サーブ(絶対高さ約2.7m)より高い約3.3mの山なり軌道になってしまっていた
      // （「セカンド向けの低いカット」という意図に反し、実質ロブに近い見た目）。
      // 14.0まで引き上げて軌道の頂点を他タイプ以下（約2.1m）に抑え、バウンド後の
      // 弾みも攻撃的カットと同程度の低さに揃えた。狙いの浅さ(depthOffset)や
      // 散らばりの小ささ(sigmaExtra)はそのまま「安全球」の性格を保つ。
      // speedを14.0→21.8へ再度引き上げ、あわせて飛行中に回転由来の沈み込み
      // (sink、下記)を追加した。単純な打ち上げ角の調整だけでは「頂点を下げる
      // ↔ 同じ浅い着地点まで届かせる」が両立しづらく、山なりを解消しきれな
      // かったため、下回転(カット)がマグヌス揚力で前半は平たく飛びつつ、
      // 失速とともに後半で沈み込むという回転特有の物理を明示的に追加する
      // 方式に変更した（sinkプロパティ、matchLoop.jsのlaunchBallで使用）。
      // speedが他タイプ並みに上がった分は、頂点を約1.3〜1.5mまで下げるために
      // 必要なトレードオフ（初速は保ちつつ、回転で軌道だけ低く抑える）。
      underCut: {
        speed: 21.8, zone: { min: 0.45, ideal: 1.0, max: 3.4 },
        depthOffset: 3.2,
        spinKind: "slice", spinMagBase: 1.3, color: "#A78BFA", label: "アンダーカット",
        sigmaExtra: -0.08, // 散らばりを抑えて入りやすくする
        // 飛行中の沈み込み: 飛行時間の72%を過ぎたあたりから、下向きの追加
        // 加速度(m/s^2)を最大120まで0.05秒でランプさせて効かせる。前半は
        // 通常の放物線と変わらず平たく飛び、後半だけ沈む＝下回転(カット)の
        // 体感に近い軌道になる。
        // maxLandVz: 着地直前の落下速度(vz)の上限(m/s)。サーブのネット回避
        // ループ(serve.js launchServeBall内、低すぎるとspeedを0.93倍ずつ
        // 落として山なりにする仕組み)でspeedが下がり飛行時間が伸びると、
        // 絶対値accelをそのまま積分するsinkは着地直前のvzが際限なく積み上が
        // ってしまう。実測では、ネット回避が働いた場合に着地直前vzが-15〜
        // -24m/s、着地角が45〜63度、バウンド頂点が4〜9mまで暴走し、
        // 「低く滑るはずのカットが不自然に高く弾んで伸びる」不具合になって
        // いた。他のカット系サーブ(attackCut/slice、sinkなし)の着地直前vzが
        // 概ね-6.4〜-7.0m/sであることに合わせ、7.5でクランプする。
        sink: { accel: 120, startFrac: 0.72, rampSec: 0.05, maxLandVz: 7.5 },
      },
      // 攻撃的カット: フラットとアンダーカットの間の、やや低めの打点が適正。速くて鋭く切れる/伸びる攻め球。
      // 適正ゾーンが狭く散らばりも大きい＝リスク高め。
      attackCut: {
        speed: 21.0, zone: { min: 1.35, ideal: 2.0, max: 3.4 },
        depthOffset: 2.0,
        spinKind: "slice", spinMagBase: 1.6, color: "#F43F5E", label: "攻撃カット",
        sigmaExtra: 0.12,  // 攻め球の分、散らばりが大きい
      },
    },
  },
  // ため（チャージ）: 長いほど鋭い角度を狙える（効果は控えめ）
  charge: {
    maxTime: 1.0,     // この秒数押し続けると最大チャージ
    angleBonus: 0.35, // 最大ためで狙える角度が+35%
    speedBonus: 0.1,  // 最大ための球速ボーナス（+10%）
    moveSlow: 0.4,    // ため中のWASD移動の速度倍率
  },
  // 着地点カーソル（ため中にマウス/スティックで狙いを自由移動）
  aim: {
    cursorSpeed: 9.0,  // カーソル移動速度(m/s)
    sideMargin: 0.5,   // サイドラインからの内側マージン（狙い自体はコート内）
    depthMargin: 0.7,  // ベースラインからの内側マージン
    minDepth: 1.0,     // ネットからの最小距離
    defaultY: 9.0,     // 未操作時のデフォルト狙い: ミドル深め（ネットからの距離）
  },
  // サーブ前のレシーブ準備（準備が整うまでサーブを打てない）
  serveReady: {
    stillTime: 0.35, // レシーブ側プレイヤーがこの秒数静止したら準備完了
    minShow: 0.9,    // 相手サーブの種類表示からトスまでの最低猶予(秒)
    maxWait: 6.0,    // 準備を待つ最大秒数（過ぎたら相手は打ってくる）
    aiReady: 0.7,    // AIレシーバーの準備時間（プレイヤーはこれを過ぎるまでトス不可）
  },
  // 雁行陣の定位置（コート座標m。後衛はベースライン後方、前衛はネット寄り）
  //   ベースラインは ±11.885。後衛はその 0.4m 後方に立つのが自然。
  pos: {
    backY: 13.0,      // 後衛の定位置（ベースライン後方約1.1m＝1〜2歩後ろ。深く構えて前へ詰めて打つ）
    frontY: 2.6,      // 前衛の定位置（ネット前）
    frontSideX: 1.8,  // 前衛が逆サイドに寄るときのx
    serveBackY: 0.6,  // サーバーがベースラインの何m後方に立つか
    serveSideX: 2.6,  // サーブ時のサイド寄りx（やや外側。センターマーク〜サイドの間）
    receiveBackY: 0.2, // レシーバーがベースラインの何m後方に立つか
    // ── 確定セオリーの定位置パラメータ ──
    frontOutsideStep: 0.55, // 前衛: 「相手後衛の打点─自センターマーク」線上から
                            //   気持ち一歩“外側”へオフセットする量(m)。利き腕の肩が線に乗る程度。
    frontMirror: 0.5,       // 前衛: 相手後衛の前後動きへ鏡対応する追従率（歩幅の約半分）
    backCrossBias: 3.9,     // 後衛: クロス展開でアレー内側の線（シングルスサイドライン≒4.1m）付近まで外に立つ。
                            //   コート中央ではなくクロス側に寄った“残り範囲の真ん中”に立つ。
    backLobCoverX: 2.3,     // 後衛: クロスへのロブで陣形が崩れたときカバーに動く横位置(m)
    // ── クロス/ストレート展開の陣形（動的切替）パラメータ ──
    crossFrontX: 2.3,       // クロス展開: 前衛が立つ「後衛がいない側」のネット前x。後衛のいない半面を分担して守る意識（センターは空けすぎない範囲）
    straightFrontX: 0.9,    // ストレート展開: 前衛が後衛と同サイドでセンターより内側に立つx（相手打点─自センター線上の内側）
    straightBackX: 2.3,     // ストレート展開: 後衛がストレート側ラインを担当する横位置x
    devHysteresis: 0.4,     // 展開判定のヒステリシス（小刻みな切替を防ぐ閾値m）
    receiveCutAdvanceY: 6.6, // アンダーカット告知時、レシーバーが前に出る到達ライン（ネットからの距離m≒サービスライン付近）
    receiveOverBackY: 12.3,  // オーバーサーブ告知時、レシーバーが下がって待つy（ベースライン付近）
  },
  // 局面間のテンポ（演出の待機時間。短いほど実戦的なテンポになる）
  tempo: {
    pointDelay: 900,   // ポイント表示→次サーブまで(ms)
    gameDelay: 1100,   // ゲーム取得→次ゲームまで(ms)
    faultDelay: 700,   // フォルト表示→打ち直しまで(ms)
    serveMsgHide: 850, // サーブ告知メッセージの自動消去まで(ms)
    rallyMsgHide: 500, // ポーチ/ボレー等のラリー中告知の表示時間(ms)
    swingDuration: 0.42, // インパクトから振り抜きが収まるまでの表示時間(秒)
    swingRecover: 0.22, // フォロースルー終了(swingT=0)後、構え直しが完了するまで次の打球を禁止する時間(秒)
  },
  // 移動の速さ（m/s）
  move: {
    playerSpeed: 7.0,   // 操作キャラの足の速さ
    partnerSpeed: 4.2,  // 味方AIの足の速さ
    cpuBackSpeed: 3.8,  // 相手後衛の足の速さ（抜けるコースを残す）
    cpuFrontSpeed: 3.6, // 相手前衛の足の速さ
    aiSpeed: 4.0,        // moveAutoAI 共通の基本速度（統一AI・観戦モード対応）
    // 移動の慣性（軽め）: 目標速度（入力ベクトル*speed等）へこの加速度/減速度で滑らかに追従する。
    // 大きいほど即応的（慣性が薄い）。最高速にはすぐ乗る程度に軽くする。
    accel: 55.0,  // 加速（m/s^2）: 動き出し・切り返しの速さ
    decel: 70.0,  // 減速（m/s^2）: 入力が無くなった/反転したときに止まる速さ
  },
  // 打点品質 → 角度幅・球速・精度の変換係数
  contact: {
    idealLateral: 0.6,     // 体の横この距離(m)が適正打点（詰まり判定を緩和）。バック側で使用
    idealLateralFore: 1.05, // フォア側の適正打点距離(m)。フォアは体からもう少し離れて打つため緩める（懐を広げ、より遠い打点まで適正扱いにする）
    minLateral: 0.15,    // これ以下は「完全に詰まり」
    idealZLow: 0.5,      // この高さ範囲が標準打点
    idealZHigh: 1.3,
    maxAngle: 5.5,       // 適正打点で狙える左右ターゲットの最大幅(コートx)。ためMAXでサイドライン際
    pullCrampMin: 0.25,  // 完全詰まり時の引っ張り方向の角度倍率（ほぼ真っ直ぐのみ）
    flowCrampMin: 0.55,  // 完全詰まり時の流し方向の角度倍率（比較的出しやすい）
    crampSpeedDrop: 0.3, // 完全詰まり時の球速低下（返すだけの球質）
    frontYIdeal: 0.35,   // 体より前(ネット寄り)この距離が適正
    yTolerance: 0.9,     // 前後ズレの許容幅
    highZBonus: 0.25,    // 高い打点の球速ボーナス（トップ打ちフラットで25m/s程度）
    lowZLoft: 0.18,      // 低い打点の球速ダウン（すくい上げで弾道が上がる）
    sigmaBase: 0.35,     // 適正打点の散らばり（狙いがコート内ならほぼ収まる）
    sigmaBad: 1.6,       // 打点が悪いときに加算される散らばり（ミス率上昇）
    backhandPower: 0.88, // バック側の威力倍率
    // 泳ぎ（打点が体から遠すぎる）
    reachSlack: 0.75,    // ideal+この距離までは泳ぎ扱いにしない(m)（フォアの懐拡大に合わせて緩和）
    reachRange: 1.05,    // そこからこの幅で泳ぎ度が最大になる(m)
    reachAngleDrop: 0.45, // 泳ぎ最大時の角度倍率低下
    reachSpeedDrop: 0.2,  // 泳ぎ最大時の球速低下
    // 前後の打点ズレ → 引っ張り/流しの変化
    frontPullBoost: 0.3,  // 前すぎ: 引っ張り方向が強くなる
    frontFlowDrop: 0.25,  // 前すぎ: 流し方向の角度がつかない
    backFlowBoost: 0.25,  // 後ろ: 流し方向が強くなる
    backPullDrop: 0.5,    // 後ろ: 引っ張り方向の角度がつかない
    frontSpeedBoost: 0.06, // 前すぎ: 低弾道で速くなりやすい
    backSpeedDrop: 0.18,   // 後ろ: 弱い球になりやすい
    driftFront: 0.35,    // 前すぎ打点で引っ張り側へ流れる量(m)
    driftBack: 0.5,      // 後ろ打点で流し側へ流れる量(m)
  },
  // スマッシュ（ネット前で高い球を上から叩き込む決め球）
  //   ネット前（netDist以内）で打点が高い（contactZ>=minZ）と自動でスマッシュ判定。
  //   通常ストロークより速く、角度が鋭く下向きに突き刺さる。
  smash: {
    minZ: 1.75,       // この打点高さ(m)以上でスマッシュ成立（高い球＝ロブ等）
    netDist: 5.0,     // ネットからこの距離(m)以内（前衛域）でのみ成立
    speed: 30.0,      // スマッシュの球速(m/s)。通常ストロークより速い決め球
    depthMin: 3.0,    // 着地の最小深さ（ネット際〜サービスライン手前へ鋭く落とす）
    depthRange: 3.5,  // 着地深さのばらつき幅
    aiLobShallowY: 7.0, // AI前衛がスマッシュで決めにいく「相手ロブが浅い」着地深さ(ネットから, m)
  },
  // 回転によるバウンド後の挙動（spinMagで強調される）。
  // バウンド後の球速を「前後(水平)」と「バウンド(垂直)」の2軸で別々に制御する:
  //   friction    : 前後(水平=vx,vy)の維持率。低い=バウンドで前進が止まる（ソフトテニスの失速感）。
  //   restitution : バウンド(垂直=vz)の反発係数。低い=低く滑る/弾まない、高い=よく弾む。
  // 前回は両方を下げすぎてバウンドが死んだため、restitution(弾み)を引き上げて
  // 弾むようにしつつ、friction(前後)は失速感を保つ範囲でやや戻す。
  // restitution は「速度」の反発係数（vz *= -restitution）。バウンドの高さ比は
  // restitution² になる。ソフトテニス規格「1.5m落下→0.8〜0.9m（高さ比0.55前後）」に
  // 合わせると速度係数は √0.55 ≈ 0.74。よって flat を約0.74 に置く。
  // 一方 friction（前後=水平の維持率）は低く保ち、「跳ねる高さはあるが前に伸びない＝
  // 失速する」というソフトテニス特有の体感を出す（着地前→後で大きく減速）。
  spin: {
    slice: { friction: 0.44, restitution: 0.60 }, // スライス/カット: 低いまま前に滑る（高さ比≈0.36、前後は flat より僅かに失速）
    drive: { friction: 0.54, restitution: 0.75 }, // ドライブ: 順回転で弾む（少し低めに調整）
    flat:  { friction: 0.46, restitution: 0.74 }, // 無回転: 規格準拠（高さ比≈0.55）
    // spinMagの効き幅の上限（matchLoop.jsのバウンド計算で k=min(magCap, spinMag) として使う）。
    // サーブのカット系(slice/underCut)がspinMagBase 1.3で運用されているため、旧cap(1.3)の
    // ままだと攻撃的カット(spinMagBase 1.6)が同じ1.3に丸められ、本来もっと低く滑るはずの
    // 攻撃カットがスライス/アンダーカットと同じ弾み方になってしまっていた。現行の
    // 最大spinMagBase(攻撃カット=1.6)まで効きを伸ばせるよう引き上げる。
    magCap: 1.6,
  },
  // 飛行中の空気抵抗（弱め）。速度に比例して毎フレーム減速させ、
  // 長い飛行ほど自然に失速するソフトテニス特有の球速感を出す。
  airDrag: 0.062, // 速度減衰係数（/秒, 速度に比例した抵抗）
  // 軌道の自然なブレ（打球時に高さ/横へわずかなランダムを加える）
  jitter: { z: 0.5, x: 0.25 },
  // AI制限（前衛がコースを守り、後衛が走って拾う構図を成立させる）
  ai: {
    backReactionDelay: 0.3,  // 相手後衛が打球に反応するまでの遅延(秒)
    backReach: 2.55,         // 後衛の打球リーチ(m)。高く弾む球も拾えるよう広め
    backChaseSpeed: 1.0,     // 追走速度の倍率（move.cpuBackSpeedに乗る）
    frontPoachChance: 0.30,         // 前衛がポーチ（邪魔しに行く）確率
    frontGuardStraightChance: 0.25, // ストレートを守る確率
    frontMiddleChance: 0.18,        // ミドルを張る確率（残りは定位置）
    frontVolleyReach: 1.05,  // 守備時のボレーリーチ（明確に届く球だけ拾い、深い球は後衛へ通す）
    poachReach: 2.0,         // ポーチに出たときのリーチ
    poachMaxPace: 11.0,      // ポーチで飛び出す球の横方向ペース上限。これより速い抜き球には踏み込まない
  },
  /* ---------------------------------------------------------
   * CPUStyle（個性パラメータ）
   * 前衛/後衛で完全に別ロジックにするのではなく、同じ判断ロジックの上で
   * 「役割らしさ」をこのパラメータの差で表現する。
   *   baseDepth     : 基本の守備深さ(0=ネット〜100=ベースライン)
   *   netBias       : 前へ出たがる度(0-1)
   *   aggression    : チャンスで攻める度(0-1)
   *   riskTolerance : リスク許容(0-1)
   *   poachBias     : ポーチ積極性(0-1)
   *   lobFear       : ロブ警戒・後退の度合い(0-1)
   *   recoveryBias  : 元の定位置へ戻る意識(0-1)
   *   reaction      : 判断速度（大きいほど速く反応, 秒の逆数的な重み）
   * ロール（前衛役/後衛役）はformationが初期値を補正するだけで、
   * ロジック自体はこのパラメータを読む共通コードを通る。
   * --------------------------------------------------------- */
  cpuStyle: {
    front: {
      baseDepth: 20, netBias: 0.85, aggression: 0.55, riskTolerance: 0.5,
      poachBias: 0.5, lobFear: 0.35, recoveryBias: 0.6, reaction: 1.1,
    },
    back: {
      baseDepth: 85, netBias: 0.2, aggression: 0.35, riskTolerance: 0.35,
      poachBias: 0.1, lobFear: 0.6, recoveryBias: 0.7, reaction: 1.0,
    },
  },
};

/* ---------------------------------------------------------
 * positionBias（0=完全前衛 〜 100=完全後衛）から個性パラメータを連続生成する。
 * TUNING.cpuStyle.front/back を bias=25/80 のアンカーとして線形補間（外側は外挿）。
 * これにより既定の雁行(front=25, back=80)では従来挙動を完全に再現しつつ、
 * 「前衛だけど後衛もできる(45)」のような連続的な選手像を1パラメータで表現できる。
 *   deepTolerance : 深い球を追う許容（biasが大きいほど高い。新規）
 * --------------------------------------------------------- */
const BIAS_FRONT_ANCHOR = 25;
const BIAS_BACK_ANCHOR = 80;
export function styleFromBias(bias) {
  const f = TUNING.cpuStyle.front;
  const b = TUNING.cpuStyle.back;
  const t = (bias - BIAS_FRONT_ANCHOR) / (BIAS_BACK_ANCHOR - BIAS_FRONT_ANCHOR);
  const lerp = (a, c) => a + (c - a) * t;
  const cl = (v) => Math.max(0, Math.min(1, v));
  return {
    baseDepth: lerp(f.baseDepth, b.baseDepth),
    netBias: cl(lerp(f.netBias, b.netBias)),
    aggression: cl(lerp(f.aggression, b.aggression)),
    riskTolerance: cl(lerp(f.riskTolerance, b.riskTolerance)),
    poachBias: cl(lerp(f.poachBias, b.poachBias)),
    lobFear: cl(lerp(f.lobFear, b.lobFear)),
    recoveryBias: cl(lerp(f.recoveryBias, b.recoveryBias)),
    reaction: lerp(f.reaction, b.reaction),
    deepTolerance: cl(0.2 + (bias / 100) * 0.7),
  };
}

/* 陣形ごとの自陣2選手のpositionBias（相手は常に雁行: front=25 / back=80）。
 * ダブル系も完全な横並びにせず、わずかな前後差を持たせる（片方が少し前/後ろ）。 */
export const FORMATION_BIAS = {
  "ganko":        { front: 25, back: 80 },
  "double-back":  { front: 72, back: 84 }, // 2人とも後衛。netPlayer(72)が少し前
  "double-front": { front: 20, back: 46 }, // 2人とも前衛。basePlayer(46)が少し後ろ
};

// canvas内部解像度。画面向きに応じて applyViewport() で切り替える（live binding）。
export let W = 720;
export let H = 1080;

/* ---- 実コート寸法（m） ---- */
export const COURT = {
  halfW: 5.485,        // ダブルスサイドライン（幅10.97m）
  singlesHalfW: 4.115, // シングルスサイドライン（幅8.23m）
  halfL: 11.885,       // ベースライン（全長23.77m）
  serviceY: 6.40,      // サービスラインはネットから6.40m
  netH: 1.07,          // ネット高
};

export const G = 9.8; // 重力 m/s^2

/* ---- カメラ（自陣ベースライン後方やや上空からの中継カメラ視点） ----
 * 横長16:9（960×540）想定。自陣ベースラインを画面下部・幅85%、相手ベースラインを
 * 画面上から約18%・幅40%の左右対称台形に投影する。俯角(pitch)を立てすぎず横方向の
 * 位置差がはっきり読めるパラメータ。fov/horizonYは下記の幾何から逆算した固定値。
 * pitchは applyViewport() が画面のアスペクト比に応じて上書きする（縦長ほど立てる）。 */
export const CAM = {
  y: 30.0,       // 自陣ベースライン(11.885)後方のカメラ距離
  z: 11.0,       // カメラ高さ
  pitch: 0.62,   // 俯角（横長の基準値。縦長画面ではapplyViewportが上書きする）
  fov: 1300,     // 焦点距離相当（縦長でコート幅が収まるよう）
  horizonY: 800, // 投影の縦オフセット（縦長で奥行きを画面に収める）
  cos: Math.cos(0.62),
  sin: Math.sin(0.62),
};

const CAM_PITCH_BASE = 0.62;  // 横長・正方形に近い画面の俯角
const CAM_PITCH_TALL = 1.08;  // 縦長(アスペクト比約2.2以上)の俯角上限

/* ---- 試合状態の定数 ---- */
export const POINT_LABELS = ["0", "1", "2", "3"];
export const POINTS_TO_WIN_GAME = 4;       // 4ポイント先取（3-3はデュース）
export const FINAL_GAME_POINTS = 7;        // ファイナルゲームは7ポイント先取（6-6はデュース）
export const GAMES_TO_WIN_MATCH = 3;       // 5ゲームマッチ・3ゲーム先取（2-2でファイナル）

/* ---- 陣形ごとの定位置（自チームのみ。相手は雁行陣固定） ---- */
export const FORMATIONS = {
  "ganko":        { back: { x: 0,    y: TUNING.pos.backY }, front: { x: TUNING.pos.frontSideX, y: TUNING.pos.frontY } },
  "double-back":  { back: { x: -2.2, y: TUNING.pos.backY }, front: { x: 2.2, y: TUNING.pos.backY } },
  "double-front": { back: { x: -2.0, y: 4.2 },             front: { x: 2.0, y: TUNING.pos.frontY } },
};

export const PLAYER_X_LIMIT = 8.0;
export const HIT_REACH = 2.1;      // 後衛の打球判定リーチ（m, 寛容め）
export const CPU_REACH = 2.0;
export const VOLLEY_REACH = 1.7;   // 前衛のボレー判定

// シュートで flat に切り替わる打点高さ(m)。標準打点上限(idealZHigh=1.3)付近を境に、
// それより高ければ速いフラット、通常〜低ければ食い込むドライブ。
export const SHOOT_FLAT_Z = 1.25;
// カットで slice に切り替わる「狙いの深さ」(ネットからの距離m)。
// 着地カーソルがこれより手前ならドロップ（止まる）、奥ならスライス（食い込む）。
// ため量での分岐は廃止し、深さは着地カーソルで連続的に決まる。
export const CUT_SLICE_DEPTH = 4.2;

export const SHOT_FAMILY_ORDER = ["shoot", "cut", "lob"];

// 系統ごとの表示メタ（HUD・カーソルの色とラベル）。色はシュート系/カット系/ロブで分ける
export const SHOT_FAMILY_META = {
  shoot: { label: "シュート", color: "#FB923C" }, // オレンジ系（flat/drive）
  cut:   { label: "カット",   color: "#38BDF8" }, // ブルー系（slice/drop）
  lob:   { label: "ロブ",     color: "#FACC15" }, // イエロー
};

/* ---- サーブのトス管理 ---- */
export const TOSS_RISE_TIME = 0.48;  // トスが頂点に達するまでの時間
export const TOSS_HOLD_TIME = 0.85;  // 頂点付近で打てる猶予（これを過ぎると落下してフォルト）
// トスは常に統一トス（base→apex）。打点ゾーンは打つ瞬間のボタンで4種に
// 振り分けるため、トス自体の高さはサーブ種類に依存しない。
export const TOSS_BASE_Z = 0.9;
export const TOSS_APEX_Z = 3.1;

export const IDEAL_HIT_DELAY = 0.14; // ため中の自動スイングが発動する打点タイミング（秒）

// オンザライン（ライン上）はイン。ボール半径＋ライン幅相当の余裕を持たせ、
// 着地点がラインに掛かっていればインと判定する。
export const LINE_IN_MARGIN = 0.12;

// 自由移動できるy方向の範囲（操作キャラクターの役割に応じて変える）
export const Y_RANGE_BACK  = { min: 1.0, max: 17.0 };
export const Y_RANGE_FRONT = { min: 0.6, max: 17.0 };

// 画面向きに応じてcanvas内部解像度とカメラ縦オフセットを切り替える。
//  - 縦画面(portrait): 2:3の縦長中継ビュー（従来）。
//  - 横画面(landscape): 横長に広げ、コートを左右いっぱいに見せて余白（地面）を広く
//    確保しつつ、縦方向はコートで満たして大きく表示する。fov/pitch は共通なので
//    投影スケールは変わらず歪まない（横幅と縦オフセットだけを変える）。
// 描画領域（court-wrap）のピクセルサイズに合わせて内部解像度・カメラを決め、
// コートを画面いっぱいに見せる。コートは「制限される辺」いっぱいに合わせ、もう一辺は
// 芝の余白にする（歪ませない）。横長画面では高さ基準、縦長画面では横幅基準になる。
export function applyViewport(availW, availH) {
  W = Math.max(320, Math.round(availW));
  H = Math.max(320, Math.round(availH));
  // 縦長画面ほど俯角を立てる。横幅基準のfovだけでは、幅に対して高さが大きい
  // ほど「近側コートが画面上部の一部にしか収まらず、下側が余った芝のまま」に
  // なる（横幅で決まるfovが小さくなるほど、同じ俯角では奥行き方向の縮尺も
  // 小さくなり続けるため）。アスペクト比(H/W)に応じてpitchを立てることで、
  // 横に余白を持たせたまま（コートが画面端で見切れないまま）、縦方向によく
  // 使われる範囲（選手が下がれる後方まで）を画面下部近くまで描画できるようにする。
  const aspect = H / W;
  const pitchT = Math.max(0, Math.min(1, (aspect - 1) / 1.2));
  CAM.pitch = CAM_PITCH_BASE + pitchT * (CAM_PITCH_TALL - CAM_PITCH_BASE);
  CAM.cos = Math.cos(CAM.pitch);
  CAM.sin = Math.sin(CAM.pitch);
  const fovByHeight = 1.95 * H; // 高さ基準（横長で支配的）
  const fovByWidth  = 1.55 * W; // 横幅基準（縦長・横に狭い画面で支配的）。鋭いワイド球で自陣後方の選手が見切れないよう左右に余白を確保
  CAM.fov = Math.min(fovByHeight, fovByWidth);
  // 奥の選手の頭上を画面上端の少し下（スコアの下＝0.14H付近）に置く。
  // fovに依らず安定して同じ高さへ来るよう逆算する。これで横長はコートが縦いっぱい、
  // 縦長は上に空（スコア）を細く取りコートを上寄せにして手前側に芝の余白を作る。
  const HEAD_Z = 1.9;
  const dyFar = CAM.y + COURT.halfL;      // 奥ベースライン(y=-halfL)までの前後距離
  const dzFar = HEAD_Z - CAM.z;
  const upFar = dyFar * CAM.sin + dzFar * CAM.cos;
  const depthFar = dyFar * CAM.cos - dzFar * CAM.sin;
  const sFar = CAM.fov / Math.max(depthFar, 0.5);
  CAM.horizonY = 0.14 * H + upFar * sFar;
  return { W, H };
}

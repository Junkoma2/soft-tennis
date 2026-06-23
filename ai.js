import {
  TUNING, COURT, G, CPU_REACH, VOLLEY_REACH,
} from "./config.js";

import {
  state, spectatorMode, rallyControlled, back, front, cpuBack, cpuFront, ball,
  matchTime, receiveDone, pointJustServedByFront, cpuJustServedByFront,
  partnerAggressiveness, formation, cpuFrontPlan, playerFrontPlan, development,
} from "./state.js";

import {
  serverTeamNow, currentServer, receiverPlayerFor, receivePosition,
} from "./serve.js";

import {
  predictLanding, predictHighContact, insideCourt, hitBall, showMessage, hideMessage, canSwingNow,
  isBackhandFor,
} from "./main.js";

import { distToBall, canPlayerHit } from "./input.js";

/* ===========================================================
 * AI（味方パートナー・CPUペア）
 *
 * 自由移動・新サーブフローに対応。難易度は従来どおり易しめ。
 * 前衛がサーブする番は「打つまでベースライン後方に留まり、
 * 打った後にサービスダッシュで前へ詰める」。
 * 味方パートナーは陣形（雁行陣/ダブル後衛/ダブル前衛）に応じた
 * 定位置で動き、操作キャラが届かないボールを返球する。
 * =========================================================== */

// 呼び出し側は従来どおり moveToward(p, tx, ty, maxDist) の形のまま使う
// （maxDist = 目標速さ*dt として渡されてくる。呼び出し側は変更不要）。
// 内部では maxDist/dt から目標速さを逆算し、速度(p.vx/p.vy)へ軽い加減速で
// 追従させてから位置を更新する＝慣性。dt は引数で明示的に受け取る。
export function moveToward(p, tx, ty, maxDist, dt) {
  const dx = tx - p.x;
  const dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  if (dt === undefined || dt <= 0) {
    // dt 未指定の呼び出し（保険）: 従来の直接移動にフォールバック
    if (d < 0.01) return;
    const step = Math.min(d, maxDist);
    p.x += (dx / d) * step;
    p.y += (dy / d) * step;
    return;
  }
  const targetSpeed = maxDist / dt;
  let targetVx = 0, targetVy = 0;
  if (d >= 0.01) {
    // 目標までの距離が今フレームの到達距離以下なら行き過ぎないよう速度を落とす
    const desired = Math.min(targetSpeed, d / dt);
    targetVx = (dx / d) * desired;
    targetVy = (dy / d) * desired;
  }
  p.vx = approachVelocity(p.vx || 0, targetVx, dt);
  p.vy = approachVelocity(p.vy || 0, targetVy, dt);
  p.x += p.vx * dt;
  p.y += p.vy * dt;
}

// フォア回り込み判定: 後衛の移動目標x（打点予測位置）が利き手と逆側（バック）に
// なりそうなとき、フォアで打てる位置へ積極的に回り込む。
//   myBack: 移動させる後衛選手オブジェクト（stats.handedを持つ）
//   homeSign: 自陣方向の符号（player=+1, cpu=-1）
//   targetX: そのまま追えば構える位置（=ボールの予測打点x）
//   approachSpeed: その後衛の到達できる速さ(m/s)
//   timeToContact: 打点までの残り時間（秒, 概算）。大きいほど回り込みに余裕がある。
// 戻り値: 回り込み後の目標x（間に合わない/既にフォア側ならtargetXのまま）。
//
// ラッチ（wrapCommitted/wrapTargetX）について:
//   この関数は毎フレーム呼ばれるが、targetX（ボール予測打点）は移動中も
//   フレームごとに微妙に変化するため、myBack.x との相対関係で決まる
//   isBackhandFor の結果が打点境界の左右でフリップしやすい。
//   「回り込む」と一度決めたら、来球1球分（myBack.wrapCommitted=true の間）は
//   wrapTargetX を再計算せず固定することで、目標xが境界をまたいで
//   往復するリミットサイクル（プルプル／ちらつき）を防ぐ。
//   ラッチの解除（myBack.wrapCommitted=false）は呼び出し側
//   （moveAutoAI、ball.lastHitterがmyTeamに変わったタイミング）で行う。
// ballContactX: バウンド後の軌道から予測した「実際に打つ打点のx」。
//   ※瞬間の ball.x ではなく軌道の行き先を使う。フォア/バック判定の軸はこれ。
// 戻り値: この来球で構える立ち位置x。併せて myBack.hitSide に fore/back を確定する。
function foreApproachX(myBack, side, ballContactX, approachSpeed, timeToContact) {
  const facingDir = side === "player" ? 1 : -1;
  const handSign = myBack.stats && myBack.stats.handed === "left" ? -1 : 1;
  const foreDir = facingDir * handSign;

  // 来球1球分はラッチ: 立ち位置とフォア/バックを固定し、毎フレームの再評価による
  // 往復（プルプル）や表示反転（フォアなのにバック）を防ぐ。ただし予測が大きく
  // ズレたら（バウンドのブレ等）解除して立て直す。
  if (myBack.wrapCommitted) {
    if (Math.abs(ballContactX - myBack.wrapBallX) <= 1.2) return myBack.wrapTargetX;
    myBack.wrapCommitted = false;
  }

  // 「基本フォアで回り込む」: ボールをフォア側（利き手側）の適正打点 idealLateralFore で
  // 迎えられる立ち位置を第一候補にする＝ボールより foreDir 側に idealLateralFore 手前に立つ
  // （体の右側で、体から少し離して打つイメージ）。
  const foreLateral = (TUNING.contact && TUNING.contact.idealLateralFore) || 0.85;
  const foreStandX = ballContactX - foreDir * foreLateral;

  let standX, hitSide;
  if (timeToContact != null && timeToContact > 0) {
    const timeNeeded = Math.abs(foreStandX - myBack.x) / Math.max(0.1, approachSpeed);
    if (timeNeeded <= timeToContact * 0.9) {
      standX = foreStandX; hitSide = "fore"; // 間に合う→フォアに回り込む
    } else {
      standX = ballContactX; hitSide = "back"; // 間に合わない→正面で迎えてバック
    }
  } else {
    // 残り時間が読めない（バウンド後など）: すでにフォア側ならフォア、そうでなければバック。
    if (isBackhandFor(side, myBack, ballContactX)) { standX = ballContactX; hitSide = "back"; }
    else { standX = foreStandX; hitSide = "fore"; }
  }

  myBack.wrapCommitted = true;
  myBack.wrapTargetX = standX;
  myBack.wrapBallX = ballContactX;
  myBack.hitSide = hitSide;
  return standX;
}

function approachVelocity(cur, target, dt) {
  const accel = TUNING.move.accel;
  const decel = TUNING.move.decel;
  const accelerating = Math.abs(target) > Math.abs(cur) && Math.sign(target) === Math.sign(cur || target);
  const rate = accelerating ? accel : decel;
  const diff = target - cur;
  const maxStep = rate * dt;
  if (Math.abs(diff) <= maxStep) return target;
  return cur + Math.sign(diff) * maxStep;
}

// 相方がいま「自分のサーブを打つ前」かどうか（AIサーバーは動かさない）
export function partnerIsServingNow(partner) {
  return (state === "serve-stance" || state === "serve-toss") &&
    serverTeamNow() === "player" && currentServer() === partner;
}

// AI自動移動の共通ロジック（playerチーム・cpuチーム共通）。
// side: "player"(自陣y+側) または "cpu"(自陣y-側)
// p: 移動させる選手オブジェクト
// ロール（前衛/後衛）は side に応じた myFront/myBack で判定する。
export function moveAutoAI(p, side, dt) {
  const speed = TUNING.move.aiSpeed * p.stats.speed;
  const myFront  = side === "player" ? front    : cpuFront;
  const myBack   = side === "player" ? back     : cpuBack;
  const oppFront = side === "player" ? cpuFront : front;
  const oppBack  = side === "player" ? cpuBack  : back;
  // 自陣方向: player側はy+（自陣ベースライン y>0）、cpu側はy-（y<0）
  const homeSign = side === "player" ? 1 : -1;
  const homeBackY  = TUNING.pos.backY * homeSign;
  const opponentTeam = side === "player" ? "cpu" : "player";
  const myTeam = side;

  // 自分がサーブを打つ前はサーブ位置から動かない
  if ((state === "serve-stance" || state === "serve-toss") &&
      serverTeamNow() === myTeam && currentServer() === p) {
    return;
  }

  // 相手サーブ中: レシーバー担当ならレシーブ位置へ、それ以外は定位置で待機
  if ((state === "serve-stance" || state === "serve-toss") &&
      serverTeamNow() === opponentTeam) {
    if (p === receiverPlayerFor(myTeam)) {
      const rp = receivePosition(myTeam);
      moveToward(p, rp.x, rp.y, speed * 1.2 * dt, dt);
    }
    return;
  }

  // 自分のサーブ前は、サーバー以外（味方前衛など）も持ち場で待つ。
  // サーブを打つ前にセンターマークを越えて動かない（ここで止める）。
  if (state === "serve-stance" || state === "serve-toss") {
    return;
  }

  // 相手のサーブが飛んでいる間（最初の返球まで＝!receiveDone）は、レシーブ担当だけがボールを追う。
  // 担当でない味方はその場で待機（前衛がレシーバーの逆クロスでも後衛が追ってしまうバグ防止）。
  if (!receiveDone && state === "rally" && ball.lastHitter === opponentTeam) {
    if (p === receiverPlayerFor(myTeam)) {
      const landing = predictLanding();
      let tx = p.x, ty = p.y;
      if (ball.bounces >= 1) {
        tx = ball.x + ball.vx * 0.2;
        ty = homeSign > 0 ? Math.min(COURT.halfL + 5.0, Math.max(4.0, ball.y + ball.vy * 0.2))
                          : Math.max(-(COURT.halfL + 5.0), Math.min(-4.0, ball.y + ball.vy * 0.2));
      } else if (landing && landing.y * homeSign > 0 && insideCourt(landing.x, landing.y)) {
        // サーブも球種・速さからバウンド後の頂点を予測し、そこで高い打点で迎える。
        const hc = predictHighContact();
        let depth = hc ? Math.abs(hc.y) : Math.abs(landing.y) + 0.6;
        depth = Math.min(COURT.halfL + 5.0, Math.max(Math.abs(landing.y), depth));
        tx = Math.max(-COURT.halfW, Math.min(COURT.halfW, hc ? hc.x : landing.x));
        ty = homeSign > 0 ? depth : -depth;
      }
      moveToward(p, tx, ty, speed * 1.25 * dt, dt);
      p.x = Math.max(-7.5, Math.min(7.5, p.x));
    }
    return;
  }

  // 前衛はレシーブが完了するまでポジション移動しない。
  // ただし自分がサーブした直後のサービスダッシュは始めてよい
  const myJustServedByFront = side === "player" ? pointJustServedByFront : cpuJustServedByFront;
  if (p === myFront && !receiveDone) {
    if (state === "rally" && myJustServedByFront && formation !== "double-back") {
      moveToward(myFront, myFront.homeX * (myBack.x > 0 ? -1 : 1), myFront.homeY, speed * 1.4 * dt, dt);
      myFront.x = Math.max(-4.6, Math.min(4.6, myFront.x));
    }
    return;
  }

  // 前衛がサーブした直後はサービスダッシュ（速めに定位置へ）
  const dash = (state === "rally" && myJustServedByFront && p === myFront &&
    formation !== "double-back") ? 1.4 : 1.0;

  if (p === myFront) {
    // 前衛
    if (formation === "double-back") {
      const targetX = myBack.x > 0 ? -2.2 : 2.2;
      moveToward(myFront, targetX, myFront.homeY, speed * dt, dt);
    } else if (state === "rally" && ball.lastHitter === opponentTeam && !ball.serving) {
      // 相手が打った瞬間も、基本は展開（クロス/ストレート）に応じた定位置を保つ。
      // 届くポーチのときだけネットへ踏み込む（常時ボール追従で同サイド/隅へ暴れさせない）。
      let frontTargetX = Math.max(-3.0, Math.min(3.0, frontDevX(myTeam)));
      let frontTy = frontMirrorY(myTeam, myFront.homeY);
      let frontDash = dash;
      // ポーチ作戦時の踏み込み移動（両チーム対称。player側は観戦モードのみ自走）。
      const myPlan = (side === "cpu") ? cpuFrontPlan : (spectatorMode ? playerFrontPlan : "base");
      if (myPlan === "poach") {
        const t2 = Math.abs(ball.vy) > 0.1 ? (myFront.homeY - ball.y) / ball.vy : -1;
        const predX = (t2 > 0) ? ball.x + ball.vx * t2 : ball.x;
        const poachReach = TUNING.ai.poachReach * myFront.stats.reach;
        if (Math.abs(predX - myFront.x) <= poachReach * 1.5) {
          frontTargetX = Math.max(-3.4, Math.min(3.4, predX));
          frontTy = myFront.homeY;
          frontDash = 1.3;
        }
      }
      // 相方前衛（プレイヤー=後衛のとき）のポーチ移動: 攻守スライダーで踏み込み積極性を制御
      if ((side === "player") && !spectatorMode && p === front &&
          rallyControlled !== front) {
        const aggr = partnerAggressiveness;
        // 着地予測でポーチ位置を決める（CPUポーチと対称）
        const t2p = Math.abs(ball.vy) > 0.1 ? (myFront.homeY - ball.y) / ball.vy : -1;
        const predXp = (t2p > 0 && t2p < 1.5) ? ball.x + ball.vx * t2p : ball.x;
        // 攻め度が高いほど広いリーチで踏み込む
        const pReach = (TUNING.ai.frontVolleyReach + aggr * 0.6) * myFront.stats.reach;
        if (aggr > 0.15 && Math.abs(predXp - myFront.x) <= pReach * 1.5) {
          frontTargetX = Math.max(-3.4, Math.min(3.4, predXp));
          frontTy = myFront.homeY;
          frontDash = 1.0 + aggr * 0.4; // 攻めるほど速く踏み込む
        }
      }
      // 前衛の守備側（後衛のいない側）のネット際へ低く来る球には、届く範囲で
      // 軽く一歩踏み込んでボレーに行く（大きくは追わず、後衛のクロス球は奪わない）。
      {
        const ownBackSign = myBack.x >= 0 ? 1 : -1;
        const frontSide = -ownBackSign; // 前衛が受け持つ側
        const tNet = Math.abs(ball.vy) > 0.1 ? (myFront.homeY - ball.y) / ball.vy : -1;
        if (tNet > 0 && tNet < 0.9) {
          const crossX = ball.x + ball.vx * tNet;
          const crossZ = ball.z + ball.vz * tNet - 0.5 * G * tNet * tNet; // ネット到達時の高さ
          const onMySide = (Math.sign(crossX) === frontSide); // 自分の守備側に来る球のみ
          const reach = TUNING.ai.frontVolleyReach * myFront.stats.reach;
          if (onMySide && crossZ < 1.3 && Math.abs(crossX - myFront.x) <= reach * 0.9) {
            frontTargetX = Math.max(-3.4, Math.min(3.4, crossX));
            frontTy = myFront.homeY;
            frontDash = Math.max(frontDash, 1.15);
          }
        }
      }
      moveToward(myFront, frontTargetX, frontTy, speed * frontDash * dt, dt);
    } else if (state === "rally") {
      // 自分チームにボールがある間は展開に応じたセオリー位置へ戻る
      const tx = Math.max(-4.4, Math.min(4.4, frontDevX(myTeam)));
      const retSpeed = (side === "cpu" && !spectatorMode) ? speed * 0.8 : speed * dash;
      moveToward(myFront, tx, frontMirrorY(myTeam, myFront.homeY), retSpeed * dt, dt);
    } else {
      moveToward(myFront, myFront.homeX * (myBack.x > 0 ? -1 : 1), myFront.homeY, speed * dash * dt, dt);
    }
    myFront.x = Math.max(-4.6, Math.min(4.6, myFront.x));
  } else {
    // 後衛: ストローク役としてボールを追う
    if (state === "rally" && ball.lastHitter === opponentTeam) {
      if ((side === "cpu" || spectatorMode) && matchTime - ball.lastHitTime < TUNING.ai.backReactionDelay) return;
      const landing = predictLanding();
      let tx = backDevX(myTeam);
      let ty = homeBackY;
      let timeToContact = null;
      if (ball.bounces >= 1) {
        // バウンド後はボールへ寄せるが、ベースライン後方へ深追いしすぎない
        // （深く下がると落ちてきた球を低く打つことになる）。
        tx = ball.x + ball.vx * 0.2;
        ty = homeSign > 0
          ? Math.min(COURT.halfL + 5.0, Math.max(4.5, ball.y + ball.vy * 0.2))
          : Math.max(-(COURT.halfL + 5.0), Math.min(-4.5, ball.y + ball.vy * 0.2));
        // バウンド後は飛行時間の見積もりが難しいため、回り込み判定用に短い猶予のみ与える
        timeToContact = 0.25;
      } else if (landing && landing.y * homeSign > 0 && insideCourt(landing.x, landing.y)) {
        const isLob = ball.spin === "flat" && ball.z > 2.0 &&
          Math.abs(landing.y) > COURT.serviceY;
        // 球種(スピン)の反発・摩擦と速さから「バウンド後にボールが最も高くなる点(頂点)」を
        // 予測し、そこに構える。これでバウンド地点へ走り込まず、最も高い打点で打てる。
        // ドライブ/フラットは高く弾むので奥め、スライスは低く滑るので手前、と自動で変わる。
        const hc = predictHighContact();
        let depth = hc ? Math.abs(hc.y) : Math.abs(landing.y) + 0.6;
        // バウンドより手前にはしない・コート後方に出すぎない
        depth = Math.min(COURT.halfL + 5.0, Math.max(Math.abs(landing.y), depth));
        const hx = hc ? hc.x : landing.x;
        const xCap = isLob ? COURT.singlesHalfW + 0.3 : COURT.halfW;
        tx = Math.max(-xCap, Math.min(xCap, hx));
        ty = homeSign > 0 ? depth : -depth;
        // 着地までの時間 + バウンド頂点までの時間 ≒ 実際に打つまでの残り時間。
        // これを基準に「フォアへ回り込めるか」を判定する。
        timeToContact = landing.t + (hc ? Math.sqrt(2 * Math.max(0, hc.apexZ) / G) : 0.15);
      }
      // ボールが利き手と逆側（バック）に来そうなら、間に合う見込みのときだけ
      // フォアで打てる位置へ積極的に回り込む（間に合わなければそのままバックハンドで対応）。
      tx = foreApproachX(myBack, myTeam, tx, speed * 1.2, timeToContact);
      // 立ち位置と一体で確定した fore/back を表示・打球判定でも使う唯一の根拠にする。
      // これで回り込み・表示・物理がすべて同じ確定値を参照し、食い違わない。
      myBack.swingSide = myBack.hitSide;
      myBack.swingSideLocked = true;
      moveToward(myBack, tx, ty, speed * 1.2 * dt, dt);
    } else {
      // 来球への対応区間（相手が打ってから自分が打つまで）を抜けたら、
      // 次の来球のために打ち方の確定（立ち位置・フォア/バック）を解除する
      // （打った後／打順が変わった後）。次の来球で改めて計画し直す。
      if (myBack.wrapCommitted) {
        myBack.wrapCommitted = false;
        myBack.wrapTargetX = null;
        myBack.wrapBallX = null;
        myBack.swingSideLocked = false;
      }
      if (state === "rally" && myJustServedByFront) {
        // 前衛パートナーがサーブした回: 後衛はカバー位置へ
        const targetX = myFront.x > 0 ? -1.6 : 1.6;
        moveToward(myBack, targetX, homeBackY * 1.02, speed * dt, dt);
      } else {
        // 自分側にボールがある間は展開に応じた定位置へ戻る
        const retSpeed = (side === "cpu" && !spectatorMode) ? speed * 0.55 : speed;
        moveToward(myBack, backDevX(myTeam), homeBackY, retSpeed * dt, dt);
      }
    }
    myBack.x = Math.max(-7.5, Math.min(7.5, myBack.x));
  }
}

// 味方パートナー（プレイヤーが操作していない方）の自動移動
export function updatePartner(dt) {
  const partner = (rallyControlled === back) ? front : back;
  moveAutoAI(partner, "player", dt);
}

// 観戦モード: 操作キャラ（rallyControlled）もAIが移動させる。
// 共通移動ロジック（moveAutoAI）を自チーム（player側）として適用する。
export function updateRallyControlledAI(dt) {
  if (!spectatorMode) return;
  moveAutoAI(rallyControlled, "player", dt);
}

// 観戦モード: 操作キャラ（rallyControlled）の打球判断（コース・球種・狙い）。
// CPU後衛のコース選択（cpuTryReturn）と同じ考え方で、相手前衛のいない側を
// 主体に狙う。球種はシュート/カット/ロブを状況に応じて振り分け、
// 着地点(aimX/aimY)に変換してbyPlayer経路（hitBall）へ渡す。
export function chooseAiHitForRallyControlled() {
  const cp = rallyControlled;

  // セオリー: 基本はクロスのコーナー（相手後衛側＝アレー寄り）へ返す。
  let course;
  if (Math.random() < 0.65) {
    course = (cpuBack.x >= 0 ? 1 : -1) * (0.78 + Math.random() * 0.32);
  } else {
    course = (Math.random() - 0.5) * 1.9;
  }

  // 球種選択: ネット前で打点が高ければスマッシュ（hitBall内で自動判定）。
  // それ以外はシュート中心、時々カット、ネット際に詰まったらロブで逃げる。
  let family;
  const r = Math.random();
  if (cp.y < 4.0 && ball.z > 1.5 && ball.z < 2.3 && r < 0.25) {
    family = "lob";
  } else if (r < 0.55) {
    family = "shoot";
  } else if (r < 0.85) {
    family = "cut";
  } else {
    family = "lob";
  }

  const aimX = Math.max(-(COURT.singlesHalfW - 0.3), Math.min(COURT.singlesHalfW - 0.3, course * 3.5));
  const depth = TUNING.aim.defaultY + (Math.random() - 0.5) * 3.0;
  const aimY = Math.max(-(COURT.halfL - 0.6), Math.min(-TUNING.aim.minDepth, -depth));

  return { shot: family, aimX: aimX, aimY: aimY };
}

export function updateCpuBack(dt) {
  moveAutoAI(cpuBack, "cpu", dt);
}

// 相手後衛（＝こちらに打ってくる側）の打点位置を返す。
//   side="cpu": 相手はプレイヤー。side="player": 相手はCPU。
// 相手が打った球が飛来中はその打点(originX)を、こちらの打球が飛行中
// （サーブ含む）は飛んでいる球ではなく相手後衛の現在位置を基準にする。
// （飛行中の自球xを使うと、球がコートを横切るのに合わせて展開判定/定位置が
//   左右に振れてしまうため）。
export function opponentHitterPos(side) {
  if (side === "cpu") {
    // CPUから見た相手＝プレイヤー側
    if (ball.lastHitter === "player") return { x: ball.originX, y: ball.originY };
    return { x: back.x, y: back.y };
  }
  if (ball.lastHitter === "cpu") return { x: ball.originX, y: ball.originY };
  return { x: cpuBack.x, y: cpuBack.y };
}

/* ===========================================================
 * クロス/ストレート展開の判定（陣形の動的切替）
 *
 * ソフトテニスのセオリー（softtennis-zenei.com /position）:
 *   クロス展開（後衛同士が対角でラリー）:
 *     「後衛がいない方のサイドに前衛が立つ」。自後衛が右なら前衛は左ネット前。
 *     前衛はサイドへ寄りすぎてセンターを空けない。
 *   ストレート展開（ボールがストレート＝同サイドへ展開）:
 *     前衛と後衛が同じサイドに並ぶ（サイドバイサイド）。前衛は
 *     「相手後衛の打点─自センター」線上でセンターより内側、後衛はストレート側ラインを担当。
 *
 * 判定: 自陣後衛と相手後衛のx符号（コート左右サイド）を比較する。
 *   後衛同士が逆サイド = クロス展開（対角でラリーしている）
 *   後衛同士が同サイド = ストレート展開（自後衛の側へ来ている）
 *   ヒステリシス: 両後衛ともセンター付近（|x|<devHysteresis）のとき切替保留。
 *   ボールの着地予測ではなく後衛の位置関係を軸にして判定を安定させる。
 * =========================================================== */

// その展開判定で使う「自陣後衛」のx符号（操作キャラ/AIに関わらずコート上の後衛役）
export function ownBackPlayer(side) { return side === "cpu" ? cpuBack : back; }
export function ownFrontPlayer(side) { return side === "cpu" ? cpuFront : front; }

// 相手の打球がこちらのどのサイドへ向かっているか（着地予測のx符号）。
// 予測できないときは相手打点の符号で代用する。
export function incomingSideSign(side) {
  const incoming = (side === "cpu") ? (ball.lastHitter === "player")
                                    : (ball.lastHitter === "cpu");
  if (incoming) {
    const landing = predictLanding();
    if (landing && Math.abs(landing.x) > 0.2) return landing.x >= 0 ? 1 : -1;
    if (Math.abs(ball.x) > 0.2) return ball.x >= 0 ? 1 : -1;
  }
  const op = opponentHitterPos(side);
  return op.x >= 0 ? 1 : -1;
}

// 展開状態（チームごと）。"cross" / "straight"。ヒステリシス付きで更新する。

// side から見た「相手後衛」
export function oppBackPlayer(side) { return side === "cpu" ? back : cpuBack; }

// 展開判定: 自陣後衛と相手後衛のx符号（コート左右サイド）を比較する。
//   後衛同士が対角（逆サイド）= クロス展開
//   後衛同士が同サイド         = ストレート展開
//   ヒステリシス: 両後衛ともセンター付近（|x| < devHysteresis）のとき切替保留。
export function updateDevelopment(side) {
  const ownBackP = ownBackPlayer(side);
  const oppBackP = oppBackPlayer(side);
  const ownBackSign = ownBackP.x >= 0 ? 1 : -1;
  const oppBackSign = oppBackP.x >= 0 ? 1 : -1;
  // 後衛同士が逆サイド=クロス展開、同サイド=ストレート展開
  const raw = (ownBackSign !== oppBackSign) ? "cross" : "straight";
  // ヒステリシス: 両後衛ともセンター付近では切替を保留する
  const hysteresis = TUNING.pos.devHysteresis;
  if (Math.abs(ownBackP.x) < hysteresis && Math.abs(oppBackP.x) < hysteresis) {
    return development[side];
  }
  development[side] = raw;
  return raw;
}

// 展開に応じた前衛のx定位置。
//   クロス: 後衛がいない側（-ownBackSign）のネット前。|x|<=3.0 でクランプ。
//   ストレート: 後衛と同サイドでセンターより内側（線上の内側）。
export function frontDevX(side) {
  const dev = updateDevelopment(side);
  const ownBackSign = ownBackPlayer(side).x >= 0 ? 1 : -1;
  if (dev === "straight") {
    // 同サイドへ並ぶ。相手打点─自センター線上の内側に寄る
    const lineX = frontTheoryX(side, ownFrontPlayer(side).homeY);
    const inside = ownBackSign * TUNING.pos.straightFrontX;
    // 線上の値と「同サイド内側」の中間。センターより内側を保つ
    const x = (lineX + inside) / 2;
    return Math.max(-3.0, Math.min(3.0, x));
  }
  // クロス展開: 後衛のいない側のネット前。隅へ吸い込まれない
  return Math.max(-3.0, Math.min(3.0, -ownBackSign * TUNING.pos.crossFrontX));
}

// 展開に応じた後衛のx定位置。
//   クロス: クロス側の残り範囲の真ん中（既存セオリー）。
//   ストレート: ストレート側ライン担当（同サイドのライン際寄り）。
export function backDevX(side) {
  const dev = updateDevelopment(side);
  if (dev === "straight") {
    const ownBackSign = ownBackPlayer(side).x >= 0 ? 1 : -1;
    return ownBackSign * TUNING.pos.straightBackX;
  }
  return backCrossX(side);
}

// 前衛の定位置（確定セオリー）:
//   「相手後衛の打点 ─ 自コートのセンターマーク」を結んだ線上、ただし
//   気持ち一歩“外側”（利き腕の肩がその線に乗る程度）に立つ。
//   side が守るコートのセンターマークは ±COURT.halfL。
//   frontY はその前衛のネット前定位置y。
export function frontTheoryX(side, frontY) {
  const op = opponentHitterPos(side);
  const cy = side === "cpu" ? -COURT.halfL : COURT.halfL; // 自コートのセンターマーク
  let lineX = 0;
  if (Math.abs(cy - op.y) >= 0.5) {
    // t>1 は op.y が cy を超えた位置（ベースライン外など）なのでクランプして破綻防止
    const t = Math.max(0, Math.min(1, (frontY - op.y) / (cy - op.y)));
    lineX = op.x * (1 - t);
  }
  // 線上から「気持ち一歩外側」へ。外側＝センターラインから離れる向き
  // （線が左側(x<0)なら更に左へ、右側なら更に右へ）。
  const outSign = lineX >= 0 ? 1 : -1;
  // 左利きの前衛は利き腕の肩が逆になるため、外側へ寄る向きを反転させる
  const frontPlayer = side === "cpu" ? cpuFront : front;
  const handSign = frontPlayer.stats.handed === "left" ? -1 : 1;
  // コート外への逸脱を防ぐ（シングルスコート幅でクランプ）
  return Math.max(-COURT.singlesHalfW, Math.min(COURT.singlesHalfW,
    lineX + outSign * handSign * TUNING.pos.frontOutsideStep));
}

// 後衛の定位置（確定セオリー）:
//   前提＝前衛がストレート側を守る。後衛はそのストレートレーンを捨て、
//   残ったクロス側範囲の“真ん中”（コート中央ではなくクロス側寄り）に立つ。
//   ストレート＝相手後衛の打点と同じ側、クロス＝その反対側。
//   side="cpu" なら自コートは y<0、相手＝プレイヤー。
export function backCrossX(side) {
  const op = opponentHitterPos(side);
  // 相手から見たストレートは相手打点と同じ符号側。クロスはその反対。
  // こちら（守る側）の自陣では、相手打点 op.x の符号と反対側がクロス。
  const straightSign = op.x >= 0 ? 1 : -1;
  // 残ったクロス側範囲（センター0〜サイドライン）の真ん中あたりへ寄る
  return -straightSign * TUNING.pos.backCrossBias;
}

// 互換: 旧名（CPU前衛のセオリーX）
export function cpuFrontTheoryX() {
  return frontTheoryX("cpu", cpuFront.homeY);
}

// 前衛が相手後衛の前後の動きへ「鏡のように」対応した定位置y（歩幅の約半分追従）。
//   side="cpu": 自陣はy<0、相手後衛はy>0側。相手が前に詰める(yが小さく)ほど前衛も前へ。
//   homeY からの追従量は frontMirror で制御。
export function frontMirrorY(side, homeY) {
  const op = opponentHitterPos(side);
  const baseDepth = COURT.halfL; // 相手後衛の標準の深さ（ベースライン）
  const opDepth = Math.abs(op.y); // 相手後衛のネットからの距離
  // 相手が前に出る(opDepthが小さい)と front も前(ネット寄り=|y|小)へ、下がると後ろへ。
  const follow = (opDepth - baseDepth) * TUNING.pos.frontMirror;
  const sign = side === "cpu" ? -1 : 1; // 自陣の向き
  // homeY は既に符号付き。|homeY| + follow を符号付きへ戻す。
  const newAbs = Math.max(1.6, Math.min(4.2, Math.abs(homeY) + follow));
  return sign * newAbs;
}

export function updateCpuFront(dt) {
  moveAutoAI(cpuFront, "cpu", dt);
}


// AI打球の共通ロジック（playerチーム・cpuチーム共通）。
// side: "player"(自陣y+側) または "cpu"(自陣y-側)
// 両チームで同一ロジック・同一パラメータ。対称性から自動的に互角になる。
export function tryReturnAI(side) {
  const opponentSide = side === "player" ? "cpu" : "player";
  if (ball.lastHitter !== opponentSide || state !== "rally") return;

  const ai = TUNING.ai;
  const sm = TUNING.smash;
  const myFront  = side === "player" ? front    : cpuFront;
  const myBack   = side === "player" ? back     : cpuBack;
  const oppBack  = side === "player" ? cpuBack  : back;
  const oppFront = side === "player" ? cpuFront : front;
  // 自陣のy符号: player=+（y>0）、cpu=-（y<0）
  const homeSign = side === "player" ? 1 : -1;
  // 前衛ボレー判定用フラグ
  const frontChecked = side === "player" ? "frontChecked" : "cpuFrontChecked";

  // ---- 後衛の早めのテイクバック準備（見た目のみ、打球判定には影響しない） ----
  // 操作プレイヤー側（main.js）はボールが自陣に入った時点でpose="prep"へ
  // 早めに移行しているが、AI後衛(cpuBack)はstartSwing（インパクト）まで
  // pose="swing"にならず、テイクバックが遅れて見える。
  // ここでも同じ考え方で、ボールが自陣側に入ったら早めにprepへ入れて
  // swingSideを固定する（実際の打球判定・タイミングはこの下のhitBall呼び出しの
  // ままで変更しない＝見た目だけの先行動作）。
  // まずは影響範囲をcpuBackに限定する（player後衛は既存のprep経路で対応済み）。
  if (side === "cpu" && canSwingNow(myBack)) {
    const ballComingHome = ball.y * homeSign > 0;
    if (ballComingHome) {
      // 先行テイクバック（見た目だけ）。フォア/バックは moveAutoAI が立ち位置と
      // 一体で確定済み（myBack.swingSide）なので、ここでは再計算しない
      // ＝回り込み・表示・物理がすべて同じ確定値を参照し、矛盾もちらつきも出ない。
      if (myBack.pose !== "prep") myBack.pose = "prep";
    } else if (myBack.pose === "prep") {
      myBack.pose = "idle";
    }
  }

  // ---- サーブの返球: レシーブ担当（前衛/後衛どちらでも）がワンバウンドで返す ----
  // 返球者を担当レシーバーに固定し、非担当（特に後衛）が横取りしないようにする。
  // ball.serving はバウンド前に解除されるため、レシーブ未完了フラグ !receiveDone で判定する。
  // 後衛の返球と同様、頂点を過ぎて落ち始めた打点（vz <= 0）で捉える。
  if (!receiveDone && ball.bounces === 1 && ball.z < 2.3 && ball.vz <= 0) {
    const receiver = receiverPlayerFor(side);
    if (canSwingNow(receiver) && distToBall(receiver) <= ai.backReach * receiver.stats.reach) {
      // セオリー: 基本はクロスのコーナー（相手後衛側＝アレー寄り）へ返す
      let course;
      if (Math.random() < 0.65) course = (oppBack.x >= 0 ? 1 : -1) * (0.78 + Math.random() * 0.32);
      else course = (Math.random() - 0.5) * 1.9;
      const r = Math.random();
      const shot = r < 0.55 ? "drive" : (r < 0.8 ? "flat" : "slice");
      hitBall({ hitter: receiver, side: side, shot: shot, course: course, contactZ: ball.z });
    }
    return;
  }

  // ---- 前衛のスマッシュ（浅いロブを叩き込む） ----
  // 自陣側（homeSign方向）のネット前〜に浮いた球を、バウンド前に叩く。
  if (!ball[frontChecked] && ball.bounces === 0 &&
      ball.y * homeSign > 0.4 && ball.y * homeSign < sm.netDist &&
      ball.z >= sm.minZ && ball.z < 2.3) {
    const landing = predictLanding();
    const shallowLob = landing && landing.y * homeSign > 0 &&
      Math.abs(landing.y) <= sm.aiLobShallowY;
    const reach = ai.poachReach * myFront.stats.reach;
    if (shallowLob && canSwingNow(myFront) && Math.hypot(ball.x - myFront.x, ball.y - myFront.y) <= reach) {
      ball[frontChecked] = true;
      if (Math.random() < 0.98 * myFront.stats.volley) {
        hitBall({
          hitter: myFront,
          side: side,
          shot: "flat",
          course: (oppBack.x > 0 ? -1 : 1) * (0.4 + Math.random() * 0.6),
          contactZ: ball.z,
        });
        const label = side === "player" ? "相方のスマッシュ！" : "相手前衛のスマッシュ！";
        showMessage(label);
        setTimeout(function () { if (state === "rally") hideMessage(); }, TUNING.tempo.rallyMsgHide);
        return;
      }
    }
  }

  // ---- 前衛のボレー/ポーチ ----
  // 自陣側（homeSign方向）のネット際に来た、まだバウンドしていない球だけを迎える。
  // 深く速いラリー球（ネットを高く越えて後衛へ抜ける球）は拾わず後衛に任せる。
  if (!ball[frontChecked] && ball.bounces === 0 &&
      ball.y * homeSign > 0.4 && ball.y * homeSign < 3.2 && ball.z < 1.6) {
    const poaching = ((side === "cpu") ? cpuFrontPlan : playerFrontPlan) === "poach";
    {
      // 前衛は届くならボレーする（ポーチ指示の有無に関わらず）。
      const reach = (poaching ? ai.poachReach : ai.frontVolleyReach) * myFront.stats.reach;
      if (canSwingNow(myFront) && Math.hypot(ball.x - myFront.x, ball.y - myFront.y) <= reach) {
        ball[frontChecked] = true;
        const chance = (poaching ? 0.9 : 0.82) * myFront.stats.volley;
        if (Math.random() < chance) {
          hitBall({
            hitter: myFront,
            side: side,
            shot: "flat",
            course: (oppBack.x > 0 ? -1 : 1) * (0.4 + Math.random() * 0.6),
            contactZ: ball.z,
          });
          let label;
          if (side === "player") {
            label = "相方のボレー！";
          } else {
            label = poaching ? "相手前衛のポーチ！" : "相手前衛のカット！";
          }
          showMessage(label);
          setTimeout(function () { if (state === "rally") hideMessage(); }, TUNING.tempo.rallyMsgHide);
          return;
        }
      }
    }
  }

  // ---- cpu前衛のポーチ（作戦による定位置移動ロジックは moveAutoAI で対応。
  //      ここではボレー判定後の「ポーチに出た位置でのボレー」のみ ----

  // ---- 後衛のワンバウンド返球 ----
  // 実際のストロークに合わせ、バウンドの頂点を過ぎて「落ち始めた」打点で打つ。
  //   vz <= 0 … 上昇が止まり下降に転じた以降（＝頂点〜落下中）。上昇中は打たない。
  //   z < 2.3 上限で頭上すぎる打点は避ける（頂点が高い球は2.3まで落ちてから打つ）。
  // 頂点〜地面までの下降中ずっと打てるので、届く位置にいれば頂点付近で自然に捉える。
  if (ball.bounces === 1 && ball.z < 2.3 && ball.vz <= 0) {
    const reach = ai.backReach * myBack.stats.reach;
    if (canSwingNow(myBack) && distToBall(myBack) <= reach) {
      // セオリー: 基本はクロスのコーナー（相手後衛側＝アレー寄り）へ深く返す。
      // 相手後衛のいる側へ外めに振り、アレー方向の球を増やす。残りは散らす。
      let course;
      if (Math.random() < 0.65) {
        const crossSign = oppBack.x >= 0 ? 1 : -1;
        course = crossSign * (0.78 + Math.random() * 0.32);
      } else {
        course = (Math.random() - 0.5) * 1.9;
      }
      // 駆け引き: 相手前衛が詰めている側へ向いた球は、ポーチされやすいので
      // ときどきオープン側（前衛のいない側）へ振り直す。常時ではなく確率的に
      // 補正し、配球が一辺倒にならないようにする。前衛がセンター付近のときは補正しない。
      const frontSign = oppFront.x >= 0 ? 1 : -1;
      if (Math.abs(oppFront.x) > 0.6 && Math.sign(course) === frontSign &&
          Math.random() < 0.6) {
        course = -frontSign * (0.55 + Math.random() * 0.35);
      }
      const r = Math.random();
      const shot = r < 0.55 ? "drive" : (r < 0.75 ? "flat" : (r < 0.9 ? "lob" : "slice"));
      hitBall({
        hitter: myBack, side: side, shot: shot,
        course: course,
        contactZ: ball.z,
      });
    }
  }
}

// 後方互換ラッパー（メインループから呼ばれる）
export function cpuTryReturn() { tryReturnAI("cpu"); }
export function partnerTryReturn() {
  if (!spectatorMode) {
    // 人間モード: 操作キャラが届かないときだけパートナーが返す
    const partner = (rallyControlled === back) ? front : back;
    const isPartnerFront = partner === front; // プレイヤーが後衛→相方は前衛
    if (ball.lastHitter !== "cpu" || state !== "rally") return;
    const ai = TUNING.ai;
    const sm = TUNING.smash;
    // 攻守スライダー値（観戦時は中庸0.5固定）
    const aggr = spectatorMode ? 0.5 : partnerAggressiveness;

    // ---- 相方前衛のスマッシュ ----
    if (isPartnerFront &&
        !ball.frontChecked && ball.bounces === 0 &&
        partner.y < sm.netDist && partner.y > 0.4 &&
        ball.y > 0.6 && ball.y < sm.netDist && ball.z >= sm.minZ && ball.z < 2.3 &&
        canSwingNow(partner) &&
        Math.hypot(ball.x - partner.x, ball.y - partner.y) <= ai.poachReach * partner.stats.reach) {
      ball.frontChecked = true;
      if (Math.random() < 0.8 * partner.stats.volley) {
        hitBall({
          hitter: partner, side: "player", shot: "flat",
          course: (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.6),
          contactZ: ball.z,
        });
        showMessage("相方のスマッシュ！");
        setTimeout(function () { if (state === "rally") hideMessage(); }, TUNING.tempo.rallyMsgHide);
        return;
      }
    }

    // ---- 相方前衛のポーチ（攻守スライダーで制御: プレイヤー=後衛のとき） ----
    // ポーチ確率: 守り(0)=0.15, 中(0.5)=0.45, 攻め(1)=0.75
    // 動き出し範囲: 攻めるほど ball.y が手前（大きい値）でも踏み込む (3.6〜5.2m)
    if (isPartnerFront &&
        !ball.frontChecked && ball.bounces === 0 &&
        ball.y > 0.6 && ball.y < (3.6 + aggr * 1.6) && ball.z < 2.0) {
      // 攻め度に応じたポーチリーチ（標準+最大0.6m拡大）
      const poachReach = (ai.frontVolleyReach + aggr * 0.6) * partner.stats.reach;
      if (canSwingNow(partner) && Math.hypot(ball.x - partner.x, ball.y - partner.y) <= poachReach) {
        ball.frontChecked = true;
        const poachChance = (0.15 + aggr * 0.6) * partner.stats.volley;
        if (Math.random() < poachChance) {
          // 相手後衛のいない側を突く（CPUポーチと対称ロジック）
          const targetCourse = (cpuBack.x > 0 ? -1 : 1) * (0.4 + Math.random() * 0.6);
          hitBall({
            hitter: partner, side: "player", shot: "flat",
            course: targetCourse,
            contactZ: ball.z,
          });
          const label = aggr >= 0.5 ? "相方のポーチ！" : "相方のボレー！";
          showMessage(label);
          setTimeout(function () { if (state === "rally") hideMessage(); }, TUNING.tempo.rallyMsgHide);
          return;
        }
      }
    }

    // ---- 相方前衛の通常ボレー ----
    if (isPartnerFront &&
        !ball.frontChecked && ball.bounces === 0 &&
        partner.y < 5.2 &&
        ball.y > 0.6 && ball.y < 4.8 && ball.z < 1.9 &&
        canSwingNow(partner) &&
        Math.hypot(ball.x - partner.x, ball.y - partner.y) <= VOLLEY_REACH) {
      ball.frontChecked = true;
      if (Math.random() < 0.5 * partner.stats.volley) {
        hitBall({
          hitter: partner, side: "player", shot: "flat",
          course: (Math.random() - 0.5) * 1.4,
          contactZ: ball.z,
        });
        showMessage("相方のボレー！");
        setTimeout(function () { if (state === "rally") hideMessage(); }, TUNING.tempo.rallyMsgHide);
        return;
      }
    }

    // ---- 相方後衛のストローク（操作キャラが届かないボールをカバー） ----
    // プレイヤー=前衛のとき（partner=back）: 攻守スライダーでコース選択を制御
    // 後衛返球と同様、頂点を過ぎて落ち始めた打点（vz <= 0）で打つ。
    if (ball.bounces === 1 && ball.z < 2.3 && ball.vz <= 0 &&
        !canPlayerHit(rallyControlled) &&
        canSwingNow(partner) &&
        distToBall(partner) <= CPU_REACH * partner.stats.reach &&
        distToBall(partner) < distToBall(rallyControlled)) {
      const shot = Math.random() < 0.8 ? "drive" : "lob";
      let course;
      if (!isPartnerFront) {
        // 相方=後衛（プレイヤー=前衛のケース）: 攻守でコース選択を変化
        // 守り寄り=クロス（相手前衛のいない側）重視, 攻め寄り=ストレート/前衛方向重視
        const straightChance = 0.15 + aggr * 0.65; // 守り=0.15, 中=0.475, 攻め=0.80
        if (Math.random() < straightChance) {
          // ストレート: 相手前衛(cpuFront)がいる側へ抜きにいく
          course = (cpuFront.x >= 0 ? 1 : -1) * (0.5 + Math.random() * 0.5);
        } else {
          // クロス: 相手前衛のいない側を安全に返す
          course = (cpuFront.x >= 0 ? -1 : 1) * (0.4 + Math.random() * 0.5);
        }
      } else {
        course = (Math.random() - 0.5) * 1.6;
      }
      hitBall({
        hitter: partner, side: "player", shot: shot,
        course: course,
        contactZ: ball.z,
      });
    }
    return;
  }
  // 観戦モード: 統一AIで返球
  tryReturnAI("player");
}

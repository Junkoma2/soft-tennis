/**
 * 3D キャラのポーズ定義と補間
 *
 * 各ポーズは関節ごとの回転角（度）。モデルの正面は +z。
 * 胸・頭は Three.js の回転をそのまま使い、下向き(-y)に伸びる手足は適用時に
 * X 回転を反転する。これによりポーズ値では正を「前へ曲げる」として扱える。
 * 右利き前衛・カメラ正対を基準にしている。
 *
 * まずは ready と forehandVolleyTakeback の 2 ポーズ。
 * applyPose() で 2 ポーズ間を滑らかに補間する。
 * 将来 splitStep / impact / followThrough / backVolley / serve 等を
 * POSES に足すだけで拡張できる。
 */

import * as THREE from "./vendor/three/three.module.js";
import { TUNING } from "./config.js";

const D = Math.PI / 180;

// rootLift: 骨盤 y のオフセット（負で重心を落とす＝しゃがむ）
export const POSES = {
  "ready": {
    "bodyLean": 8,
    "rootLift": -0.06,
    "chest": {
      "x": 0,
      "y": 0,
      "z": 0
    },
    "head": {
      "x": 0,
      "y": 0,
      "z": 0
    },
    "shoulderR": {
      "x": 38,
      "y": 4,
      "z": -26
    },
    "elbowR": {
      "x": -48,
      "y": 0,
      "z": 0
    },
    "handR": {
      "x": 4,
      "y": 0,
      "z": 0
    },
    "racket": {
      "x": 8,
      "y": 0,
      "z": 90
    },
    "shoulderL": {
      "x": 80,
      "y": 0,
      "z": -12
    },
    "elbowL": {
      "x": -108,
      "y": 0,
      "z": 0
    },
    "hipR": {
      "x": 10,
      "y": 0,
      "z": 12
    },
    "kneeR": {
      "x": -22,
      "y": 0,
      "z": 0
    },
    "footR": {
      "x": 20,
      "y": 0,
      "z": 0
    },
    "hipL": {
      "x": 10,
      "y": 0,
      "z": -12
    },
    "kneeL": {
      "x": -22,
      "y": 0,
      "z": 0
    },
    "footL": {
      "x": 20,
      "y": 0,
      "z": 0
    }
  },
  "rearReady": {
    "bodyLean": 8,
    "rootLift": -0.08,
    "chest": {
      "x": 0,
      "y": 0,
      "z": 0
    },
    "head": {
      "x": 0,
      "y": 0,
      "z": 0
    },
    "shoulderR": {
      "x": 81,
      "y": -83,
      "z": -28
    },
    "elbowR": {
      "x": -23,
      "y": 42,
      "z": 0
    },
    "handR": {
      "x": 54,
      "y": 112,
      "z": -42
    },
    "racket": {
      "x": 91,
      "y": -1,
      "z": 93
    },
    "shoulderL": {
      "x": 46,
      "y": 8,
      "z": -18
    },
    "elbowL": {
      "x": -74,
      "y": 0,
      "z": 0
    },
    "hipR": {
      "x": 14,
      "y": 0,
      "z": 14
    },
    "kneeR": {
      "x": -28,
      "y": 0,
      "z": 0
    },
    "footR": {
      "x": 26,
      "y": 0,
      "z": 0
    },
    "hipL": {
      "x": 14,
      "y": 0,
      "z": -14
    },
    "kneeL": {
      "x": -28,
      "y": 0,
      "z": 0
    },
    "footL": {
      "x": 26,
      "y": 0,
      "z": 0
    }
  },
  "forehandVolleyTakeback": {
    "bodyLean": 7,
    "rootLift": -0.07,
    "pelvisTurn": 6,
    "chest": {
      "x": 0,
      "y": 12,
      "z": 0
    },
    "head": {
      "x": 0,
      "y": -8,
      "z": 0
    },
    "shoulderR": {
      "x": 46,
      "y": -4,
      "z": -20
    },
    "elbowR": {
      "x": -54,
      "y": 0,
      "z": 0
    },
    "handR": {
      "x": -6,
      "y": 0,
      "z": 0
    },
    "racket": {
      "x": 92,
      "y": 0,
      "z": 0
    },
    "shoulderL": {
      "x": 56,
      "y": 8,
      "z": -24
    },
    "elbowL": {
      "x": -92,
      "y": 0,
      "z": 0
    },
    "hipR": {
      "x": 12,
      "y": 0,
      "z": 12
    },
    "kneeR": {
      "x": -26,
      "y": 0,
      "z": 0
    },
    "footR": {
      "x": 20,
      "y": 0,
      "z": 0
    },
    "hipL": {
      "x": 12,
      "y": 0,
      "z": -12
    },
    "kneeL": {
      "x": -26,
      "y": 0,
      "z": 0
    },
    "footL": {
      "x": 20,
      "y": 0,
      "z": 0
    }
  },
  "forehandTakeback": {
    "bodyLean": 7,
    "rootLift": -0.07,
    "rootShiftX": 0.045,
    "rootShiftZ": -0.015,
    "pelvisTurn": 18,
    "chest": {
      "x": 0,
      "y": 42,
      "z": 0
    },
    "head": {
      "x": 0,
      "y": -30,
      "z": 0
    },
    "shoulderR": {
      "x": 52,
      "y": -20,
      "z": 34
    },
    "elbowR": {
      "x": -50,
      "y": 0,
      "z": 0
    },
    "handR": {
      "x": -10,
      "y": 0,
      "z": 0
    },
    "racket": {
      "x": 24,
      "y": -10,
      "z": -58
    },
    "shoulderL": {
      "x": 88,
      "y": -8,
      "z": -12
    },
    "elbowL": {
      "x": -10,
      "y": 0,
      "z": 0
    },
    "hipROffset": {
      "x": 0.02,
      "y": 0,
      "z": -0.07
    },
    "hipLOffset": {
      "x": -0.01,
      "y": 0,
      "z": 0.03
    },
    "hipR": {
      "x": 14,
      "y": 0,
      "z": 14
    },
    "kneeR": {
      "x": -30,
      "y": 0,
      "z": 0
    },
    "footR": {
      "x": 22,
      "y": 0,
      "z": 0
    },
    "hipL": {
      "x": 10,
      "y": 0,
      "z": -14
    },
    "kneeL": {
      "x": -22,
      "y": 0,
      "z": 0
    },
    "footL": {
      "x": 18,
      "y": 0,
      "z": 0
    }
  },
  "rearForehandTakeback": {
    "bodyLean": -1,
    "rootLift": -0.06,
    "rootShiftX": -0.15,
    "rootShiftZ": -0.13,
    "pelvisTurn": 48,
    "chest": {
      "x": 0,
      "y": 50,
      "z": 0
    },
    "head": {
      "x": 0,
      "y": -34,
      "z": 0
    },
    "shoulderR": {
      "x": 66,
      "y": -74,
      "z": 21
    },
    "elbowR": {
      "x": 71,
      "y": -13,
      "z": 52
    },
    "handR": {
      "x": 69,
      "y": -8,
      "z": -52
    },
    "racket": {
      "x": -6,
      "y": -12,
      "z": -88
    },
    "shoulderL": {
      "x": 4,
      "y": 8,
      "z": -88
    },
    "elbowL": {
      "x": -6,
      "y": 0,
      "z": 0
    },
    "hipROffset": {
      "x": 0.025,
      "y": 0,
      "z": -0.09
    },
    "hipLOffset": {
      "x": 0.035,
      "y": 0,
      "z": -0.02
    },
    "hipR": {
      "x": 18,
      "y": 0,
      "z": 16
    },
    "kneeR": {
      "x": -38,
      "y": 0,
      "z": 0
    },
    "footR": {
      "x": 24,
      "y": 0,
      "z": 0
    },
    "hipL": {
      "x": 49,
      "y": -40,
      "z": -45
    },
    "kneeL": {
      "x": -26,
      "y": 0,
      "z": 0
    },
    "footL": {
      "x": 20,
      "y": 0,
      "z": 0
    }
  },
  "rearForehandLoad": {
    "bodyLean": 1,
    "rootLift": -0.065,
    "rootShiftX": -0.12,
    "rootShiftZ": -0.06,
    "pelvisTurn": 38,
    "chest": {
      "x": 6,
      "y": -15,
      "z": 0
    },
    "head": {
      "x": 0,
      "y": -18,
      "z": 0
    },
    "shoulderR": {
      "x": 56,
      "y": -66,
      "z": 27
    },
    "elbowR": {
      "x": 44,
      "y": -16,
      "z": 40
    },
    "handR": {
      "x": 17,
      "y": 6,
      "z": -35
    },
    "racket": {
      "x": -20,
      "y": -40,
      "z": -140
    },
    "shoulderL": {
      "x": 18,
      "y": 2,
      "z": -58
    },
    "elbowL": {
      "x": -14,
      "y": 0,
      "z": 0
    },
    "hipROffset": {
      "x": 0.025,
      "y": 0,
      "z": -0.105
    },
    "hipLOffset": {
      "x": 0.037,
      "y": 0.018,
      "z": 0.02
    },
    "hipR": {
      "x": 17,
      "y": 0,
      "z": 15
    },
    "kneeR": {
      "x": -35,
      "y": 0,
      "z": 0
    },
    "footR": {
      "x": 23,
      "y": 0,
      "z": 0
    },
    "hipL": {
      "x": 38,
      "y": -38,
      "z": -26
    },
    "kneeL": {
      "x": -25,
      "y": 0,
      "z": 0
    },
    "footL": {
      "x": 19,
      "y": 0,
      "z": 0
    }
  },
  "forehandContact": {
    "bodyLean": 5,
    "rootLift": -0.05,
    "rootShiftX": -0.045,
    "rootShiftZ": 0.06,
    "pelvisTurn": 18,
    "chest": {
      "x": 1,
      "y": 22,
      "z": 0
    },
    "head": {
      "x": 0,
      "y": -14,
      "z": 0
    },
    "shoulderR": {
      "x": 66,
      "y": 10,
      "z": 14
    },
    "elbowR": {
      "x": -18,
      "y": 0,
      "z": 0
    },
    "handR": {
      "x": 0,
      "y": 0,
      "z": 0
    },
    "racket": {
      "x": 0,
      "y": 82,
      "z": -8
    },
    "shoulderL": {
      "x": 42,
      "y": -10,
      "z": 22
    },
    "elbowL": {
      "x": -34,
      "y": 0,
      "z": 0
    },
    "hipROffset": {
      "x": 0.02,
      "y": 0,
      "z": -0.12
    },
    "hipLOffset": {
      "x": -0.04,
      "y": 0,
      "z": 0.25
    },
    "hipR": {
      "x": 14,
      "y": 0,
      "z": 12
    },
    "kneeR": {
      "x": -28,
      "y": 0,
      "z": 0
    },
    "footR": {
      "x": 20,
      "y": 0,
      "z": 0
    },
    "hipL": {
      "x": 10,
      "y": 0,
      "z": -12
    },
    "kneeL": {
      "x": -20,
      "y": 0,
      "z": 0
    },
    "footL": {
      "x": 16,
      "y": 0,
      "z": 0
    }
  },
  "rearForehandContact": {
    "bodyLean": 6,
    "rootLift": -0.07,
    "rootShiftX": -0.06,
    "rootShiftZ": 0.08,
    "pelvisTurn": 20,
    "chest": {
      "x": 7,
      "y": -36,
      "z": -1
    },
    "head": {
      "x": -1,
      "y": 21,
      "z": 0
    },
    "shoulderR": {
      "x": 101,
      "y": -2,
      "z": 19
    },
    "elbowR": {
      "x": -6,
      "y": -21,
      "z": 11
    },
    "handR": {
      "x": -38,
      "y": -66,
      "z": -6
    },
    "racket": {
      "x": 119,
      "y": -140,
      "z": -36
    },
    "shoulderL": {
      "x": 44,
      "y": -12,
      "z": 24
    },
    "elbowL": {
      "x": -34,
      "y": 0,
      "z": 0
    },
    "hipROffset": {
      "x": 0.025,
      "y": 0,
      "z": -0.14
    },
    "hipLOffset": {
      "x": 0.04,
      "y": 0.045,
      "z": 0.09
    },
    "hipR": {
      "x": 16,
      "y": 0,
      "z": 12
    },
    "kneeR": {
      "x": -30,
      "y": 0,
      "z": 0
    },
    "footR": {
      "x": 22,
      "y": 0,
      "z": 0
    },
    "hipL": {
      "x": 21,
      "y": -35,
      "z": 1
    },
    "kneeL": {
      "x": -24,
      "y": 0,
      "z": 0
    },
    "footL": {
      "x": 18,
      "y": 0,
      "z": 0
    }
  },
  "rearForehandDrive": {
    "bodyLean": 7,
    "rootLift": -0.055,
    "rootShiftX": -0.065,
    "rootShiftZ": 0.087,
    "pelvisTurn": 8,
    "chest": {
      "x": 1,
      "y": -25,
      "z": 0
    },
    "head": {
      "x": -1,
      "y": 17,
      "z": 0
    },
    "shoulderR": {
      "x": 114,
      "y": -33,
      "z": -30
    },
    "elbowR": {
      "x": -18,
      "y": -42,
      "z": 7
    },
    "handR": {
      "x": -19,
      "y": 32,
      "z": -40
    },
    "racket": {
      "x": 88,
      "y": -48,
      "z": -18
    },
    "shoulderL": {
      "x": 40,
      "y": -16,
      "z": 27
    },
    "elbowL": {
      "x": -32,
      "y": 0,
      "z": 0
    },
    "hipROffset": {
      "x": 0.03,
      "y": 0.035,
      "z": -0.1
    },
    "hipLOffset": {
      "x": 0.005,
      "y": 0.055,
      "z": 0.16
    },
    "hipR": {
      "x": 21,
      "y": 0,
      "z": 9
    },
    "kneeR": {
      "x": -38,
      "y": 0,
      "z": 0
    },
    "footR": {
      "x": 22,
      "y": 0,
      "z": 0
    },
    "hipL": {
      "x": 16,
      "y": -24,
      "z": -4
    },
    "kneeL": {
      "x": -22,
      "y": 0,
      "z": 0
    },
    "footL": {
      "x": 17,
      "y": 0,
      "z": 0
    }
  },
  "forehandFollow": {
    "bodyLean": 4,
    "rootLift": -0.03,
    "rootShiftX": -0.05,
    "rootShiftZ": 0.075,
    "pelvisTurn": -2,
    "chest": {
      "x": 1,
      "y": -4,
      "z": 0
    },
    "head": {
      "x": 0,
      "y": 4,
      "z": 0
    },
    "shoulderR": {
      "x": 44,
      "y": 28,
      "z": -50
    },
    "elbowR": {
      "x": -46,
      "y": 0,
      "z": 0
    },
    "handR": {
      "x": -8,
      "y": 0,
      "z": 0
    },
    "racket": {
      "x": 18,
      "y": 28,
      "z": -54
    },
    "shoulderL": {
      "x": 34,
      "y": -18,
      "z": 28
    },
    "elbowL": {
      "x": -30,
      "y": 0,
      "z": 0
    },
    "hipROffset": {
      "x": 0.03,
      "y": 0.055,
      "z": -0.055
    },
    "hipLOffset": {
      "x": -0.04,
      "y": 0,
      "z": 0.24
    },
    "hipR": {
      "x": 24,
      "y": 0,
      "z": 6
    },
    "kneeR": {
      "x": -42,
      "y": 0,
      "z": 0
    },
    "footR": {
      "x": 20,
      "y": 0,
      "z": 0
    },
    "hipL": {
      "x": 8,
      "y": 0,
      "z": -10
    },
    "kneeL": {
      "x": -18,
      "y": 0,
      "z": 0
    },
    "footL": {
      "x": 14,
      "y": 0,
      "z": 0
    }
  },
  "rearForehandFollow": {
    "bodyLean": 8,
    "rootLift": -0.04,
    "rootShiftX": -0.075,
    "rootShiftZ": 0.095,
    "pelvisTurn": -3,
    "chest": {
      "x": 2,
      "y": -6,
      "z": 0
    },
    "head": {
      "x": -1,
      "y": 5,
      "z": 0
    },
    "shoulderR": {
      "x": 93,
      "y": -11,
      "z": -47
    },
    "elbowR": {
      "x": -30,
      "y": -57,
      "z": 1
    },
    "handR": {
      "x": 4,
      "y": -25,
      "z": -121
    },
    "racket": {
      "x": 51,
      "y": -82,
      "z": -14
    },
    "shoulderL": {
      "x": 36,
      "y": -20,
      "z": 30
    },
    "elbowL": {
      "x": -30,
      "y": 0,
      "z": 0
    },
    "hipROffset": {
      "x": 0.035,
      "y": -0.14,
      "z": -0.105
    },
    "hipLOffset": {
      "x": 0.015,
      "y": 0.015,
      "z": 0.04
    },
    "hipR": {
      "x": 28,
      "y": 0,
      "z": 43
    },
    "kneeR": {
      "x": -48,
      "y": 17,
      "z": 0
    },
    "footR": {
      "x": 22,
      "y": 0,
      "z": 0
    },
    "hipL": {
      "x": 30,
      "y": 14,
      "z": -20
    },
    "kneeL": {
      "x": -20,
      "y": 0,
      "z": 0
    },
    "footL": {
      "x": 16,
      "y": 0,
      "z": 0
    }
  },
  "backhandTakeback": {
    "bodyLean": 8,
    "rootLift": -0.08,
    "rootShiftX": 0.04,
    "pelvisTurn": -10,
    "chest": {
      "x": 0,
      "y": -38,
      "z": 0
    },
    "head": {
      "x": 0,
      "y": 26,
      "z": 0
    },
    "shoulderR": {
      "x": 76,
      "y": 4,
      "z": 60
    },
    "elbowR": {
      "x": -60,
      "y": 0,
      "z": 0
    },
    "handR": {
      "x": -10,
      "y": 0,
      "z": 0
    },
    "racket": {
      "x": 88,
      "y": 10,
      "z": 8
    },
    "shoulderL": {
      "x": 48,
      "y": 10,
      "z": -20
    },
    "elbowL": {
      "x": -42,
      "y": 0,
      "z": 0
    },
    "hipR": {
      "x": 12,
      "y": 0,
      "z": 14
    },
    "kneeR": {
      "x": -26,
      "y": 0,
      "z": 0
    },
    "footR": {
      "x": 20,
      "y": 0,
      "z": 0
    },
    "hipL": {
      "x": 14,
      "y": 0,
      "z": -14
    },
    "kneeL": {
      "x": -30,
      "y": 0,
      "z": 0
    },
    "footL": {
      "x": 22,
      "y": 0,
      "z": 0
    }
  },
  "backhandContact": {
    "bodyLean": 6,
    "rootLift": -0.06,
    "rootShiftX": -0.04,
    "pelvisTurn": 6,
    "chest": {
      "x": 1,
      "y": 8,
      "z": 0
    },
    "head": {
      "x": 0,
      "y": -5,
      "z": 0
    },
    "shoulderR": {
      "x": 88,
      "y": -8,
      "z": 18
    },
    "elbowR": {
      "x": -18,
      "y": 0,
      "z": 0
    },
    "handR": {
      "x": 0,
      "y": 0,
      "z": 0
    },
    "racket": {
      "x": 82,
      "y": 8,
      "z": 14
    },
    "shoulderL": {
      "x": 38,
      "y": 18,
      "z": -24
    },
    "elbowL": {
      "x": -30,
      "y": 0,
      "z": 0
    },
    "hipR": {
      "x": 10,
      "y": 0,
      "z": 12
    },
    "kneeR": {
      "x": -20,
      "y": 0,
      "z": 0
    },
    "footR": {
      "x": 16,
      "y": 0,
      "z": 0
    },
    "hipL": {
      "x": 14,
      "y": 0,
      "z": -12
    },
    "kneeL": {
      "x": -28,
      "y": 0,
      "z": 0
    },
    "footL": {
      "x": 20,
      "y": 0,
      "z": 0
    }
  },
  // サーブ: トス後にラケットを背中側へ落とすトロフィーポジション。
  // 非利き手（shoulderL）はトスを終えた直後の高い位置を残す。
  "serveTakeback": {
    "bodyLean": -6,
    "rootLift": -0.10,
    "rootShiftZ": -0.05,
    "pelvisTurn": 20,
    "chest": {
      "x": -10,
      "y": 20,
      "z": 0
    },
    "head": {
      "x": -8,
      "y": -10,
      "z": 0
    },
    "shoulderR": {
      "x": 20,
      "y": -60,
      "z": 70
    },
    "elbowR": {
      "x": 70,
      "y": 20,
      "z": 20
    },
    "handR": {
      "x": 10,
      "y": 0,
      "z": -10
    },
    "racket": {
      "x": -60,
      "y": -10,
      "z": -110
    },
    "shoulderL": {
      "x": 110,
      "y": 10,
      "z": -30
    },
    "elbowL": {
      "x": -20,
      "y": 0,
      "z": 0
    },
    "hipR": {
      "x": 14,
      "y": 0,
      "z": 12
    },
    "kneeR": {
      "x": -30,
      "y": 0,
      "z": 0
    },
    "footR": {
      "x": 20,
      "y": 0,
      "z": 0
    },
    "hipL": {
      "x": 14,
      "y": 0,
      "z": -12
    },
    "kneeL": {
      "x": -30,
      "y": 0,
      "z": 0
    },
    "footL": {
      "x": 20,
      "y": 0,
      "z": 0
    }
  },
  // サーブ: 頭上のインパクト。膝を伸ばし切って高い打点を捉える。
  "serveImpact": {
    "bodyLean": 10,
    "rootLift": 0.02,
    "rootShiftZ": 0.05,
    "pelvisTurn": 4,
    "chest": {
      "x": 6,
      "y": 4,
      "z": 0
    },
    "head": {
      "x": 4,
      "y": -4,
      "z": 0
    },
    "shoulderR": {
      "x": 150,
      "y": -6,
      "z": 10
    },
    "elbowR": {
      "x": -10,
      "y": 0,
      "z": 0
    },
    "handR": {
      "x": 0,
      "y": 0,
      "z": 0
    },
    "racket": {
      "x": 30,
      "y": 4,
      "z": -4
    },
    "shoulderL": {
      "x": 40,
      "y": -10,
      "z": -30
    },
    "elbowL": {
      "x": -30,
      "y": 0,
      "z": 0
    },
    "hipR": {
      "x": 8,
      "y": 0,
      "z": 10
    },
    "kneeR": {
      "x": -14,
      "y": 0,
      "z": 0
    },
    "footR": {
      "x": 12,
      "y": 0,
      "z": 0
    },
    "hipL": {
      "x": 8,
      "y": 0,
      "z": -10
    },
    "kneeL": {
      "x": -14,
      "y": 0,
      "z": 0
    },
    "footL": {
      "x": 12,
      "y": 0,
      "z": 0
    }
  },
  // サーブ: インパクト後、腕が体の前を横切って収まるフォロースルー。
  "serveFollow": {
    "bodyLean": 14,
    "rootLift": -0.04,
    "rootShiftX": 0.05,
    "rootShiftZ": 0.09,
    "pelvisTurn": -10,
    "chest": {
      "x": 4,
      "y": -20,
      "z": 0
    },
    "head": {
      "x": 2,
      "y": 10,
      "z": 0
    },
    "shoulderR": {
      "x": 60,
      "y": 30,
      "z": -60
    },
    "elbowR": {
      "x": -50,
      "y": 0,
      "z": 0
    },
    "handR": {
      "x": -10,
      "y": 0,
      "z": 0
    },
    "racket": {
      "x": 10,
      "y": 30,
      "z": -60
    },
    "shoulderL": {
      "x": 20,
      "y": -14,
      "z": 30
    },
    "elbowL": {
      "x": -34,
      "y": 0,
      "z": 0
    },
    "hipR": {
      "x": 20,
      "y": 0,
      "z": 8
    },
    "kneeR": {
      "x": -36,
      "y": 0,
      "z": 0
    },
    "footR": {
      "x": 18,
      "y": 0,
      "z": 0
    },
    "hipL": {
      "x": 10,
      "y": 0,
      "z": -10
    },
    "kneeL": {
      "x": -20,
      "y": 0,
      "z": 0
    },
    "footL": {
      "x": 16,
      "y": 0,
      "z": 0
    }
  },
  "backhandFollow": {
    "bodyLean": 5,
    "rootLift": -0.04,
    "rootShiftX": -0.06,
    "pelvisTurn": 22,
    "chest": {
      "x": 1,
      "y": 42,
      "z": 0
    },
    "head": {
      "x": 0,
      "y": -28,
      "z": 0
    },
    "shoulderR": {
      "x": 78,
      "y": -18,
      "z": -34
    },
    "elbowR": {
      "x": -68,
      "y": 0,
      "z": 0
    },
    "handR": {
      "x": -14,
      "y": 0,
      "z": 0
    },
    "racket": {
      "x": 96,
      "y": 12,
      "z": 20
    },
    "shoulderL": {
      "x": 72,
      "y": 22,
      "z": 34
    },
    "elbowL": {
      "x": -18,
      "y": 0,
      "z": 0
    },
    "hipR": {
      "x": 8,
      "y": 0,
      "z": 10
    },
    "kneeR": {
      "x": -18,
      "y": 0,
      "z": 0
    },
    "footR": {
      "x": 14,
      "y": 0,
      "z": 0
    },
    "hipL": {
      "x": 24,
      "y": 0,
      "z": -6
    },
    "kneeL": {
      "x": -42,
      "y": 0,
      "z": 0
    },
    "footL": {
      "x": 20,
      "y": 0,
      "z": 0
    }
  }
};

// スイングの3〜5キーフレーム（phase 0..1）。impact/contact の位相は
// TUNING.tempo.impactPhase を参照し、打球発生タイミング（matchLoop.js）と揃える。
const SWING_KEYS = {
  frontFore: [
    { p: 0.0, pose: "forehandTakeback" },
    { p: TUNING.tempo.impactPhase.front, pose: "forehandContact" },
    { p: 0.74, pose: "forehandFollow" },
  ],
  rearFore: [
    { p: 0.0, pose: "rearForehandTakeback" },
    { p: 0.30, pose: "rearForehandLoad" },
    { p: TUNING.tempo.impactPhase.rear, pose: "rearForehandContact" },
    { p: 0.64, pose: "rearForehandDrive" },
    { p: 0.78, pose: "rearForehandFollow" },
  ],
  back: [
    { p: 0.0, pose: "backhandTakeback" },
    { p: TUNING.tempo.impactPhase.back, pose: "backhandContact" },
    { p: 1.0, pose: "backhandFollow" },
  ],
};

// サーブの4キーフレーム: トス後のテイクバック(トロフィーポジション) →
// インパクト → フォロースルー。impact の位相は TUNING.tempo.impactPhase.serve
// を参照し、matchLoop.js 側のボール発生タイミングと揃える。
const SERVE_KEYS = [
  { p: 0.0, pose: "serveTakeback" },
  { p: TUNING.tempo.impactPhase.serve, pose: "serveImpact" },
  { p: 0.82, pose: "serveFollow" },
];

const JOINT_NAMES = [
  "chest", "head", "shoulderR", "elbowR", "handR", "racket",
  "shoulderL", "elbowL", "hipR", "kneeR", "footR", "hipL", "kneeL", "footL",
];

// 腕と脚のメッシュは各ピボットから local -Y へ伸びる。
// そのため、上向きに連なる胸・頭とは X 回転の前後が逆になる。
// ポーズ定義は「正=前へ曲げる」の感覚で保ち、適用時にだけ反転する。
const DOWNWARD_LIMB_JOINTS = new Set([
  "shoulderR", "shoulderL",
  "hipR", "kneeR", "footR", "hipL", "kneeL", "footL",
]);
const LOWER_BODY_JOINTS = new Set([
  "hipR", "kneeR", "footR", "hipL", "kneeL", "footL",
]);
const RACKET_ARM_JOINTS = new Set([
  "shoulderR", "elbowR", "handR", "racket",
]);
const POSITION_JOINTS = ["hipR", "hipL"];

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function smoothstep(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}
function catmullRom(a, b, c, d, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * b) +
    (-a + c) * t +
    (2 * a - 5 * b + 4 * c - d) * t2 +
    (-a + 3 * b - 3 * c + d) * t3
  );
}

function applyPositionOffset(joints, name, offset) {
  const joint = joints[name];
  if (!joint) return;
  if (!joint.userData.basePosition) joint.userData.basePosition = joint.position.clone();
  const base = joint.userData.basePosition;
  offset = offset || {};
  joint.position.set(
    base.x + (offset.x || 0),
    base.y + (offset.y || 0),
    base.z + (offset.z || 0)
  );
}

const _shoeWorld = new THREE.Vector3();

function alignShoesToGround(joints) {
  const { pelvis, leanRoot, shoeR, shoeL } = joints;
  if (!pelvis || !shoeR || !shoeL) return;

  pelvis.updateWorldMatrix(true, true);
  let lowest = Infinity;
  for (const shoe of [shoeR, shoeL]) {
    shoe.getWorldPosition(_shoeWorld);
    lowest = Math.min(lowest, _shoeWorld.y - (shoe.userData.groundRadius || 0));
  }

  // leanRoot の傾きで local Y と world Y に差が出るため補正する。
  const yProjection = leanRoot ? Math.max(0.25, Math.abs(Math.cos(leanRoot.rotation.x))) : 1;
  pelvis.position.y += (0.01 - lowest) / yProjection;
}

function lerpEuler(name, jointPose, ea, eb, t) {
  ea = ea || { x: 0, y: 0, z: 0 };
  eb = eb || { x: 0, y: 0, z: 0 };
  const xSign = DOWNWARD_LIMB_JOINTS.has(name) ? -1 : 1;
  jointPose.rotation.set(
    lerp(ea.x, eb.x, t) * D * xSign,
    lerp(ea.y, eb.y, t) * D,
    lerp(ea.z, eb.z, t) * D
  );
}

function splineEuler(name, jointPose, e0, e1, e2, e3, t, overrides) {
  e0 = e0 || e1 || {};
  e1 = e1 || {};
  e2 = e2 || {};
  e3 = e3 || e2 || {};
  const xSign = DOWNWARD_LIMB_JOINTS.has(name) ? -1 : 1;
  const ySign = overrides && overrides.invertY ? -1 : 1;
  jointPose.rotation.set(
    catmullRom(e0.x || 0, e1.x || 0, e2.x || 0, e3.x || 0, t) * D * xSign,
    catmullRom(e0.y || 0, e1.y || 0, e2.y || 0, e3.y || 0, t) * D * ySign,
    catmullRom(e0.z || 0, e1.z || 0, e2.z || 0, e3.z || 0, t) * D
  );
}

/**
 * joints に poseA→poseB を t(0..1) で補間して適用。
 * @param {object} joints createCharacter() の joints
 * @param {string} poseAName
 * @param {string} poseBName
 * @param {number} t
 * @param {number} baseHipY simpleCharacter のデフォルト骨盤 y（0.78）
 */
export function applyPose(joints, poseAName, poseBName, t, baseHipY, timing) {
  const A = POSES[poseAName] || POSES.ready;
  const B = POSES[poseBName] || A;
  const lowerT = timing ? timing.lower : t;
  const torsoT = timing ? timing.torso : t;
  const armT = timing ? timing.arm : t;

  const leanA = A.bodyLean || 0;
  const leanB = B.bodyLean || 0;
  if (joints.leanRoot) joints.leanRoot.rotation.x = lerp(leanA, leanB, torsoT) * D;

  for (const name of JOINT_NAMES) {
    if (!joints[name]) continue;
    const jointT = LOWER_BODY_JOINTS.has(name)
      ? lowerT
      : (RACKET_ARM_JOINTS.has(name) ? armT : torsoT);
    lerpEuler(name, joints[name], A[name], B[name], jointT);
  }

  for (const name of POSITION_JOINTS) {
    const a = A[`${name}Offset`] || {};
    const b = B[`${name}Offset`] || {};
    applyPositionOffset(joints, name, {
      x: lerp(a.x || 0, b.x || 0, lowerT),
      y: lerp(a.y || 0, b.y || 0, lowerT),
      z: lerp(a.z || 0, b.z || 0, lowerT),
    });
  }

  // 重心（骨盤 y）
  const liftA = A.rootLift || 0;
  const liftB = B.rootLift || 0;
  if (joints.pelvis) {
    joints.pelvis.position.x = lerp(A.rootShiftX || 0, B.rootShiftX || 0, lowerT);
    joints.pelvis.position.z = lerp(A.rootShiftZ || 0, B.rootShiftZ || 0, lowerT);
    joints.pelvis.position.y = (baseHipY || 0.78) + lerp(liftA, liftB, lowerT);
    joints.pelvis.rotation.y = lerp(A.pelvisTurn || 0, B.pelvisTurn || 0, lowerT) * D;
  }
  alignShoesToGround(joints);
}

/* ========================================================
 * 左手をラケットのスロート（三角部分）へ合わせる簡易2ボーンIK
 * throat の位置を chest ローカルで解き、左腕(shoulderL/elbowL)を
 * 身体の前からそこへ届かせる。
 * ======================================================== */
const _vGrip = new THREE.Vector3();
const _vTarget = new THREE.Vector3();
const _vRoot = new THREE.Vector3();
const _vAim = new THREE.Vector3();
const _vPole = new THREE.Vector3();
const _vElbowPos = new THREE.Vector3();
const _vUpperDir = new THREE.Vector3();
const _vLowerDir = new THREE.Vector3();
const _vLocalLower = new THREE.Vector3();
const _qShoulderInv = new THREE.Quaternion();
const _DOWN = new THREE.Vector3(0, -1, 0);
const _LEFT_ELBOW_POLE = new THREE.Vector3(-0.86, -0.26, 0.38);

function clamp1(v) { return v < -1 ? -1 : v > 1 ? 1 : v; }

export function applyLeftHandGrip(joints, dims, root3D) {
  const { chest, handR, racketThroat, shoulderL, elbowL } = joints;
  const supportTarget = racketThroat || handR;
  if (!chest || !supportTarget || !shoulderL || !elbowL || !dims) return;

  // ラケットのスロート（三角部分）を chest ローカルへ。
  root3D.updateMatrixWorld(true);
  supportTarget.getWorldPosition(_vGrip);
  _vTarget.copy(_vGrip);
  chest.worldToLocal(_vTarget);
  _vTarget.z += 0.08; // 手と前腕を胴体表面より前へ出す

  // shoulderL は chest の子。肘を身体の外側かつ前方へ逃がして解く。
  _vRoot.copy(shoulderL.position);
  _vAim.copy(_vTarget).sub(_vRoot);
  const L1 = dims.upperArm, L2 = dims.foreArm;
  let dist = _vAim.length();
  dist = Math.min((L1 + L2) * 0.999, Math.max(Math.abs(L1 - L2) + 1e-3, dist));
  _vAim.normalize();

  const shoulderAng = Math.acos(clamp1((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)));

  // aim に直交する pole 成分を作り、その方向へ肘を置く。
  _vPole.copy(_LEFT_ELBOW_POLE).sub(_vRoot);
  _vPole.addScaledVector(_vAim, -_vPole.dot(_vAim));
  if (_vPole.lengthSq() < 1e-6) _vPole.set(-1, 0, 1);
  _vPole.normalize();
  _vElbowPos.copy(_vRoot)
    .addScaledVector(_vAim, Math.cos(shoulderAng) * L1)
    .addScaledVector(_vPole, Math.sin(shoulderAng) * L1);

  _vUpperDir.copy(_vElbowPos).sub(_vRoot).normalize();
  _vLowerDir.copy(_vTarget).sub(_vElbowPos).normalize();

  // 上腕・前腕をそれぞれ解いた方向へ向ける。円柱なのでねじりは不要。
  shoulderL.quaternion.setFromUnitVectors(_DOWN, _vUpperDir);
  _qShoulderInv.copy(shoulderL.quaternion).invert();
  _vLocalLower.copy(_vLowerDir).applyQuaternion(_qShoulderInv);
  elbowL.quaternion.setFromUnitVectors(_DOWN, _vLocalLower);
}

/* ========================================================
 * スイング位相（swingT 由来）
 * ======================================================== */

/** swingT(残り時間) → phase 0..1（0=テイクバック開始, 1=振り抜き終了）。 */
export function swingPhaseOf(pl) {
  const dur = (TUNING.tempo && TUNING.tempo.swingDuration) || 0.42;
  return Math.max(0, Math.min(1, 1 - (pl.swingT || 0) / dur));
}

/** phase に応じ、SWING_KEYS の隣接2キーフレームを補間して joints へ適用。 */
export function applySwingPhase(joints, side, phase, baseHipY, isFront) {
  if (!isFront && side !== "back") {
    applyRearForehandStroke(joints, phase, baseHipY);
    return;
  }

  const keys = side === "back"
    ? SWING_KEYS.back
    : (isFront ? SWING_KEYS.frontFore : SWING_KEYS.rearFore);
  let i = 0;
  while (i < keys.length - 1 && phase > keys[i + 1].p) i++;
  const k0 = keys[i];
  const k1 = keys[Math.min(i + 1, keys.length - 1)];
  const span = k1.p - k0.p;
  const t = span > 0 ? (phase - k0.p) / span : 0;
  const clampedT = clamp01(t);
  const isRelease = k0.pose.endsWith("Contact");
  const torsoDelay = isRelease ? 0.01 : (isFront ? 0.04 : 0.08);
  const armDelay = isRelease ? 0.01 : (isFront ? 0.11 : (side === "back" ? 0.16 : 0.18));
  // 脚と骨盤を先行させ、胸・肩、最後にラケットが追いつく。
  applyPose(joints, k0.pose, k1.pose, clampedT, baseHipY, {
    lower: smoothstep(clampedT),
    torso: smoothstep((clampedT - torsoDelay) / (1 - torsoDelay)),
    arm: smoothstep((clampedT - armDelay) / (1 - armDelay)),
  });
}

function poseAt(keys, phase) {
  let i = 0;
  while (i < keys.length - 1 && phase > keys[i + 1].p) i++;
  const k0 = keys[i];
  const k1 = keys[Math.min(i + 1, keys.length - 1)];
  const span = k1.p - k0.p;
  const t = span > 0 ? clamp01((phase - k0.p) / span) : 0;
  return {
    prev: POSES[keys[Math.max(0, i - 1)].pose],
    from: POSES[k0.pose],
    to: POSES[k1.pose],
    next: POSES[keys[Math.min(keys.length - 1, i + 2)].pose],
    t,
  };
}

function applyRearForehandStroke(joints, phase, baseHipY) {
  // SWING_KEYS.rearFore と同じキーフレームを使う（二重定義を避ける）。
  const { prev, from, to, next, t } = poseAt(SWING_KEYS.rearFore, phase);
  const eased = smoothstep(t);
  const armT = t;
  const lowerT = eased;
  const torsoT = eased;

  if (joints.leanRoot) {
    joints.leanRoot.rotation.x = catmullRom(prev.bodyLean || 0, from.bodyLean || 0, to.bodyLean || 0, next.bodyLean || 0, torsoT) * D;
  }

  for (const name of JOINT_NAMES) {
    if (!joints[name]) continue;
    const jointT = LOWER_BODY_JOINTS.has(name)
      ? lowerT
      : (RACKET_ARM_JOINTS.has(name) ? armT : torsoT);
    splineEuler(name, joints[name], prev[name], from[name], to[name], next[name], jointT);
  }

  for (const name of POSITION_JOINTS) {
    applyPositionOffset(joints, name, {
      x: catmullRom((prev[`${name}Offset`] || {}).x || 0, (from[`${name}Offset`] || {}).x || 0, (to[`${name}Offset`] || {}).x || 0, (next[`${name}Offset`] || {}).x || 0, lowerT),
      y: catmullRom((prev[`${name}Offset`] || {}).y || 0, (from[`${name}Offset`] || {}).y || 0, (to[`${name}Offset`] || {}).y || 0, (next[`${name}Offset`] || {}).y || 0, lowerT),
      z: catmullRom((prev[`${name}Offset`] || {}).z || 0, (from[`${name}Offset`] || {}).z || 0, (to[`${name}Offset`] || {}).z || 0, (next[`${name}Offset`] || {}).z || 0, lowerT),
    });
  }

  if (joints.pelvis) {
    joints.pelvis.position.x = catmullRom(prev.rootShiftX || 0, from.rootShiftX || 0, to.rootShiftX || 0, next.rootShiftX || 0, lowerT);
    joints.pelvis.position.z = catmullRom(prev.rootShiftZ || 0, from.rootShiftZ || 0, to.rootShiftZ || 0, next.rootShiftZ || 0, lowerT);
    joints.pelvis.position.y = (baseHipY || 0.78) + catmullRom(prev.rootLift || 0, from.rootLift || 0, to.rootLift || 0, next.rootLift || 0, lowerT);
    joints.pelvis.rotation.y = catmullRom(prev.pelvisTurn || 0, from.pelvisTurn || 0, to.pelvisTurn || 0, next.pelvisTurn || 0, lowerT) * D;
  }
  alignShoesToGround(joints);
}

/**
 * 状態 pose → 使用する静的ポーズ名（スイング以外）。
 * - prep（ため／テイクバック）: フォア/バックのテイクバック
 * - volley（前衛ボレー）: フォアボレーのテイクバック（両手）
 * - その他（idle/ready/recover）: 構え
 */
export function poseNameForPlayer(pl, isFront) {
  const p = pl && pl.pose;
  const front = !!isFront;
  if (p === "toss") return "serveTakeback";
  if (p === "prep") {
    if (pl.swingSide === "back") return "backhandTakeback";
    return front ? "forehandTakeback" : "rearForehandTakeback";
  }
  if (p === "volley") return front ? "forehandVolleyTakeback" : "rearReady";
  return front ? "ready" : "rearReady";
}

/**
 * ストローク/ボレー/スマッシュ（打者の側 side="fore"/"back" と前衛/後衛 isFront）で、
 * スイング開始(phase=0)からインパクトのキーフレームに達するまでの位相(0..1)。
 * matchLoop.js 側の打球発生（ボールの実発生）はこの位相に一致させる。
 */
export function impactPhaseFor(side, isFront) {
  const keys = side === "back"
    ? SWING_KEYS.back
    : (isFront ? SWING_KEYS.frontFore : SWING_KEYS.rearFore);
  const found = keys.find((k) => /Contact/.test(k.pose));
  return found ? found.p : 0.5;
}

/** サーブのインパクト位相（matchLoop.js 側のボール発生タイミングと共有）。 */
export function serveImpactPhase() {
  const found = SERVE_KEYS.find((k) => /Impact/.test(k.pose));
  return found ? found.p : TUNING.tempo.impactPhase.serve;
}

/** phase に応じ、SERVE_KEYS の隣接2キーフレームを補間して joints へ適用する（サーブ専用）。 */
export function applyServeSwingPhase(joints, phase, baseHipY) {
  let i = 0;
  while (i < SERVE_KEYS.length - 1 && phase > SERVE_KEYS[i + 1].p) i++;
  const k0 = SERVE_KEYS[i];
  const k1 = SERVE_KEYS[Math.min(i + 1, SERVE_KEYS.length - 1)];
  const span = k1.p - k0.p;
  const t = span > 0 ? (phase - k0.p) / span : 0;
  const clampedT = clamp01(t);
  applyPose(joints, k0.pose, k1.pose, clampedT, baseHipY, {
    lower: smoothstep(clampedT),
    torso: smoothstep(clampedT),
    arm: smoothstep(clampedT),
  });
}

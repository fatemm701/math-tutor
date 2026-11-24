"""兼容旧入口：转发至统一训练脚本 scripts/train_diagnosis.py --topic equation。"""

from __future__ import annotations

import sys

from train_diagnosis import main

if __name__ == "__main__":
    if "--topic" not in sys.argv:
        sys.argv.insert(1, "--topic")
        sys.argv.insert(2, "equation")
    main()

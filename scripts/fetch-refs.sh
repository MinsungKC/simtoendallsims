#!/usr/bin/env bash
# Fetch the real PROS / LemLib / EZ-Template headers used to compile-check generated code.
# (host g++ -fsyntax-only; nothing is built or flashed.)  Usage: npm run fetch-refs
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .refs && cd .refs
clone() { [ -d "$2" ] || git clone -q --depth 1 ${3:+--branch "$3"} "$1" "$2"; }
clone https://github.com/purduesigbots/pros pros 4.2.2
clone https://github.com/LemLib/LemLib LemLib stable
clone https://github.com/EZ-Robotics/EZ-Template EZ-Template
clone https://github.com/JacksonAreaRobotics/JAR-Template JAR-Template
echo "refs ready in .refs/"

// Minimal stand-in for the VEXcode V5 SDK, ONLY for `g++ -fsyntax-only` checks of generated code
// against the real JAR-Template headers. Signatures follow the public VEX API; behavior is absent.
#pragma once
#include <cstdint>
#include <cstdio>
#include <cstdarg>
#include <cmath>
namespace vex {
constexpr int32_t PORT1 = 0, PORT2 = 1, PORT3 = 2, PORT4 = 3, PORT5 = 4, PORT6 = 5, PORT7 = 6, PORT8 = 7, PORT9 = 8,
                  PORT10 = 9, PORT11 = 10, PORT12 = 11, PORT13 = 12, PORT14 = 13, PORT15 = 14, PORT16 = 15, PORT17 = 16,
                  PORT18 = 17, PORT19 = 18, PORT20 = 19, PORT21 = 20, PORT22 = 21;
enum class gearSetting { ratio36_1, ratio18_1, ratio6_1 };
constexpr gearSetting ratio36_1 = gearSetting::ratio36_1, ratio18_1 = gearSetting::ratio18_1, ratio6_1 = gearSetting::ratio6_1;
enum class directionType { fwd, rev };
constexpr directionType fwd = directionType::fwd, reverse = directionType::rev;
enum class voltageUnits { volt, mV };
constexpr voltageUnits volt = voltageUnits::volt;
enum class timeUnits { sec, msec };
constexpr timeUnits msec = timeUnits::msec, sec = timeUnits::sec;
enum class rotationUnits { deg, rev, raw };
constexpr rotationUnits deg = rotationUnits::deg;
enum class brakeType { coast, brake, hold };
constexpr brakeType hold = brakeType::hold;
enum class controllerType { primary, partner };
constexpr controllerType primary = controllerType::primary;

class triport {
 public:
  class port { public: port() {} };
  explicit triport(int32_t) {}
  port A, B, C, D, E, F, G, H;
  port Port[8];
};
class brain {
 public:
  struct screen_t {
    void clearScreen() {}
    void printAt(int, int, const char*, ...) {}
    bool pressing() { return false; }
  } Screen;
  struct battery_t { int capacity() { return 100; } } Battery;
  triport ThreeWirePort{PORT22};
};
class motor {
 public:
  motor(int32_t, gearSetting, bool) {}
  motor(int32_t, bool) {}
  motor(int32_t) {}
  void spin(directionType, double, voltageUnits) {}
  void spin(directionType, double, timeUnits) {}
  void stop() {}
  void stop(brakeType) {}
  double position(rotationUnits) { return 0; }
};
class motor_group {
 public:
  motor_group() {}
  template <typename... M> motor_group(motor&, M&...) {}
  void spin(directionType, double, voltageUnits) {}
  void stop() {}
  void stop(brakeType) {}
  double position(rotationUnits) { return 0; }
};
class inertial {
 public:
  explicit inertial(int32_t) {}
  double rotation() { return 0; }
  void calibrate() {}
};
class rotation {
 public:
  explicit rotation(int32_t) {}
  double position(rotationUnits) { return 0; }
};
class encoder {
 public:
  explicit encoder(triport::port&) {}
  double position(rotationUnits) { return 0; }
};
class pneumatics {
 public:
  explicit pneumatics(triport::port&) {}
  void open() {}
  void close() {}
};
class controller {
 public:
  struct axis { int value() { return 0; } };
  struct button { bool pressing() { return false; } };
  explicit controller(controllerType) {}
  axis Axis1, Axis2, Axis3, Axis4;
  button ButtonL1, ButtonL2, ButtonR1, ButtonR2, ButtonUp, ButtonDown, ButtonLeft, ButtonRight, ButtonA, ButtonB, ButtonX, ButtonY;
};
class competition {
 public:
  void autonomous(void (*)(void)) {}
  void drivercontrol(void (*)(void)) {}
};
class thread {
 public:
  thread(void (*)(void)) {}
};
class task {
 public:
  static void sleep(uint32_t) {}
};
inline void wait(double, timeUnits) {}
}  // namespace vex

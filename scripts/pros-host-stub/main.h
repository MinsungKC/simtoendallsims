// Host-side stand-in for PROS, used ONLY to run the generic generated motions against a simple plant.
#pragma once
#include <cstdint>
#include <cstdio>
#include <cmath>
#include <functional>
#include <initializer_list>
#include <vector>
#include <cstdarg>
#define TIMEOUT_MAX 0xffffffff
namespace pros {
enum motor_brake_mode_e_t { E_MOTOR_BRAKE_COAST, E_MOTOR_BRAKE_BRAKE, E_MOTOR_BRAKE_HOLD };
enum motor_encoder_units_e_t { E_MOTOR_ENCODER_ROTATIONS };
enum class MotorGears { red, green, blue };
enum controller_id_e_t { E_CONTROLLER_MASTER };
extern int g_now_ms;
extern std::function<void(int)> g_on_tick;  // advances the plant by 1 ms
inline int millis() { return g_now_ms; }
inline void delay(int ms) { for (int i = 0; i < ms; i++) { g_now_ms++; if (g_on_tick) g_on_tick(1); } }
struct Mutex { bool take(uint32_t) { return true; } bool give() { return true; } };
struct Task { explicit Task(std::function<void()>) {} };
struct Motor;
struct MotorGroup {
  double power = 0;
  double position_rot = 0;
  bool braking = false;
  MotorGroup(std::initializer_list<int>, MotorGears) {}
  void move(double p) { power = p; braking = false; }
  void brake() { power = 0; braking = true; }
  void set_brake_mode_all(motor_brake_mode_e_t) {}
  void set_encoder_units_all(motor_encoder_units_e_t) {}
  void tare_position_all() { position_rot = 0; }
  std::vector<double> get_position_all() { return {position_rot}; }
};
struct Imu {
  double rotation = 0;
  explicit Imu(int) {}
  void reset() {}
  bool is_calibrating() { return false; }
  double get_rotation() { return rotation; }
};
struct Rotation {
  double centideg = 0;
  explicit Rotation(int) {}
  double get_position() { return centideg; }
  void reset_position() { centideg = 0; }
};
namespace adi {
struct Encoder { double ticks = 0; Encoder(char, char, bool = false) {} double get_value() { return ticks; } void reset() {} };
struct DigitalOut { explicit DigitalOut(char) {} void set_value(bool) {} };
}  // namespace adi
struct Controller {
  explicit Controller(controller_id_e_t) {}
  int get_analog(int) { return 0; }
  bool get_digital(int) { return false; }
  bool get_digital_new_press(int) { return false; }
};
namespace lcd { inline void initialize() {} inline void print(int, const char*, ...) {} }
}  // namespace pros
#define ANALOG_LEFT_Y 1
#define ANALOG_RIGHT_X 2
#define ANALOG_RIGHT_Y 3
#define DIGITAL_R1 1
#define DIGITAL_R2 2
#define DIGITAL_L1 3

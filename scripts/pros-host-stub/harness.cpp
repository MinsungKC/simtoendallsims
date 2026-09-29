// Appended after the generated main.cpp. Simulates a tank drive plant and runs scenarios given on argv.
#include <cstdlib>
#include <cstring>
int pros::g_now_ms = 0;
std::function<void(int)> pros::g_on_tick;

static double hx = 0, hy = 0, hth = 0;  // true pose (in, in, deg cw from +y)
static double vl = 0, vr = 0;           // wheel speeds in/s
static const double VMAX = 60;          // in/s at 127

static void plant_tick(int ms) {
  const double dt = ms / 1000.0;
  const double tl = left_motors.power / 127.0 * VMAX, tr = right_motors.power / 127.0 * VMAX;
  const double a = 1 - std::exp(-dt / 0.06);  // first-order motor lag
  vl += (tl - vl) * a;
  vr += (tr - vr) * a;
  const double v = (vl + vr) / 2, w = (vl - vr) / gen::TRACK_WIDTH;  // rad/s, clockwise +
  const double mid = (hth + w * dt * 90 / M_PI) * M_PI / 180;
  hx += v * dt * std::sin(mid);
  hy += v * dt * std::cos(mid);
  hth += w * dt * 180 / M_PI;
  const double circ = M_PI * gen::WHEEL_DIAMETER * gen::GEAR_RATIO;
  left_motors.position_rot += vl * dt / circ;
  right_motors.position_rot += vr * dt / circ;
  imu.rotation = hth;
  if (pros::g_now_ms % 10 == 0) gen::odom_update();
}

int main(int argc, char** argv) {
  pros::g_on_tick = plant_tick;
  hx = 0; hy = 0; hth = 0;
  gen::init();
  gen::set_pose(0, 0, 0);
  for (int i = 1; i < argc; i++) {
    double a, b, c;
    if (std::sscanf(argv[i], "point:%lf,%lf", &a, &b) == 2) gen::move_to_point(a, b, 4000);
    else if (std::sscanf(argv[i], "rpoint:%lf,%lf", &a, &b) == 2) gen::move_to_point(a, b, 4000, {.forwards = false});
    else if (std::sscanf(argv[i], "pose:%lf,%lf,%lf", &a, &b, &c) == 3) gen::move_to_pose(a, b, c, 5000);
    else if (std::sscanf(argv[i], "turn:%lf", &a) == 1) gen::turn_to_heading(a, 3000);
    else if (std::sscanf(argv[i], "swingL:%lf", &a) == 1) gen::swing_to_heading(a, gen::Lock::LEFT, 3000);
  }
  gen::Pose est = gen::get_pose();
  std::printf("%.3f %.3f %.3f %.3f %.3f %.3f %d\n", hx, hy, hth, est.x, est.y, est.theta, pros::g_now_ms);
  return 0;
}

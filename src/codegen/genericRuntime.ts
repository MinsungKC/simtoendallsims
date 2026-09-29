/**
 * Self-contained PROS 4 C++ runtime for the "generic" target: odometry (IMU + drive/tracking wheels) and
 * LemLib-equivalent motions (PID with exit conditions, slew, boomerang, pure pursuit). This mirrors src/core/lemlib.ts.
 * Placeholders in double-underscores are substituted by generateGeneric().
 */
export const GENERIC_RUNTIME = String.raw`
namespace gen {

struct Pose { double x = 0, y = 0, theta = 0; }; // inches, degrees (0 = +y, clockwise +)
struct PathPt { double x, y, speed; };
struct Gains { double kP, kI, kD, windup, smallErr; int smallT; double largeErr; int largeT; double slew; };

constexpr Gains LATERAL = __LATERAL__;
constexpr Gains ANGULAR = __ANGULAR__;

static Pose g_pose;
static pros::Mutex g_pose_mutex;
static double g_dist = -1; // inches (or degrees) traveled in the running motion, -1 when idle

inline double sgn(double v) { return v < 0 ? -1 : 1; }
inline double deg2rad(double d) { return d * M_PI / 180; }
inline double rad2deg(double r) { return r * 180 / M_PI; }

inline Pose get_pose() {
    g_pose_mutex.take(TIMEOUT_MAX);
    Pose p = g_pose;
    g_pose_mutex.give();
    return p;
}

// ---------------------------------------------------------------- sensors / odometry
__SENSORS__

static double s_prev_l = 0, s_prev_r = 0, s_prev_imu = 0, s_prev_v = 0, s_prev_h = 0;
static double s_theta = 0; // rad, clockwise from +y

inline double wheel_travel(pros::MotorGroup& m) {
    std::vector<double> pos = m.get_position_all();
    double sum = 0;
    for (double p : pos) sum += p;
    return (sum / pos.size()) * (WHEEL_DIAMETER * M_PI) * GEAR_RATIO;
}

inline void odom_snapshot() {
    s_prev_l = wheel_travel(left_motors);
    s_prev_r = wheel_travel(right_motors);
    s_prev_imu = deg2rad(imu.get_rotation());
    s_prev_v = read_vertical();
    s_prev_h = read_horizontal();
}

inline void set_pose(double x, double y, double heading) {
    g_pose_mutex.take(TIMEOUT_MAX);
    g_pose.x = x;
    g_pose.y = y;
    g_pose.theta = heading;
    s_theta = deg2rad(heading);
    g_pose_mutex.give();
    odom_snapshot();
}

inline void odom_update() {
    const double dv = read_vertical() - s_prev_v;
    const double dh = read_horizontal() - s_prev_h;
    s_prev_v += dv;
    s_prev_h += dh;
    const double imu_now = deg2rad(imu.get_rotation());
    const double dImu = imu_now - s_prev_imu;
    s_prev_imu = imu_now;
    const double l = wheel_travel(left_motors), r = wheel_travel(right_motors);
    const double dl = l - s_prev_l, dr = r - s_prev_r;
    s_prev_l = l;
    s_prev_r = r;

    double heading = s_theta;
    __HEADING__
    const double dHeading = heading - s_theta;
    const double avg = s_theta + dHeading / 2;

    // vertical distance: tracking wheel if fitted, else the left drive motors (offset = -track/2), like LemLib
    const double dY = HAS_VERTICAL ? dv : dl;
    const double vOff = HAS_VERTICAL ? VERTICAL_OFFSET : -TRACK_WIDTH / 2;
    const double dX = HAS_HORIZONTAL ? dh : 0;
    const double hOff = HAS_HORIZONTAL ? HORIZONTAL_OFFSET : 0;
    double localX, localY;
    if (dHeading == 0) {
        localX = dX;
        localY = dY;
    } else {
        localX = 2 * std::sin(dHeading / 2) * (dX / dHeading + hOff);
        localY = 2 * std::sin(dHeading / 2) * (dY / dHeading + vOff);
    }
    g_pose_mutex.take(TIMEOUT_MAX);
    g_pose.x += localY * std::sin(avg) - localX * std::cos(avg);
    g_pose.y += localY * std::cos(avg) + localX * std::sin(avg);
    s_theta = heading;
    g_pose.theta = rad2deg(heading);
    g_pose_mutex.give();
    (void)dr;
}

inline void init() {
    imu.reset();
    while (imu.is_calibrating()) pros::delay(10);
    left_motors.set_encoder_units_all(pros::E_MOTOR_ENCODER_ROTATIONS);
    right_motors.set_encoder_units_all(pros::E_MOTOR_ENCODER_ROTATIONS);
    left_motors.tare_position_all();
    right_motors.tare_position_all();
    reset_trackers();
    odom_snapshot();
    static pros::Task odom_task([]() {
        while (true) {
            odom_update();
            pros::delay(10);
        }
    });
}

// ---------------------------------------------------------------- control helpers
inline double slew(double target, double current, double maxChange) {
    if (maxChange == 0) return target;
    double change = target - current;
    if (change > maxChange) change = maxChange;
    else if (change < -maxChange) change = -maxChange;
    return current + change;
}

enum class Dir { AUTO, CW, CCW };

inline double sanitize(double a, double m) { return std::fmod(std::fmod(a, m) + m, m); }

inline double angle_error(double target, double pos, double max, Dir dir = Dir::AUTO) {
    target = sanitize(target, max);
    pos = sanitize(pos, max);
    const double raw = target - pos;
    if (dir == Dir::CW) return raw < 0 ? raw + max : raw;
    if (dir == Dir::CCW) return raw > 0 ? raw - max : raw;
    return std::remainder(raw, max);
}

struct PID {
    const Gains& g;
    double integral = 0, prev = 0;
    explicit PID(const Gains& g) : g(g) {}
    double update(double e) {
        integral += e;
        if (sgn(e) != sgn(prev)) integral = 0;
        if (std::fabs(e) > g.windup && g.windup != 0) integral = 0;
        const double d = e - prev;
        prev = e;
        return e * g.kP + integral * g.kI + d * g.kD;
    }
};

struct Exit {
    double range;
    int time;
    int start = -1;
    bool done = false;
    void update(double in) {
        const int now = pros::millis();
        if (std::fabs(in) > range) start = -1;
        else if (start == -1) start = now;
        else if (now >= start + time) done = true;
    }
};

inline void drive(double l, double r) {
    left_motors.move(l);
    right_motors.move(r);
}

inline double curvature(const double px, const double py, const double th, const double ox, const double oy) {
    const double side = sgn(std::sin(th) * (ox - px) - std::cos(th) * (oy - py));
    const double a = -std::tan(th);
    const double c = std::tan(th) * px - py;
    const double x = std::fabs(a * ox + oy + c) / std::sqrt(a * a + 1);
    const double d = std::hypot(ox - px, oy - py);
    return side * ((2 * x) / (d * d));
}

// ---------------------------------------------------------------- turning
enum class Lock { NONE, LEFT, RIGHT };

struct TurnOpts {
    Dir direction = Dir::AUTO;
    double maxSpeed = 127;
    double minSpeed = 0;
    double earlyExit = 0;
    bool forwards = true;
};

inline void turn_impl(bool toPoint, double a, double b, int timeout, Lock lock, TurnOpts o) {
    PID pid(ANGULAR);
    Exit large{ANGULAR.largeErr, ANGULAR.largeT}, small{ANGULAR.smallErr, ANGULAR.smallT};
    const int t0 = pros::millis();
    const double startTheta = get_pose().theta;
    bool settling = false, havePrev = false;
    double prevRaw = 0, prevDelta = 0, prevPower = 0;
    g_dist = 0;
    if (lock == Lock::LEFT) left_motors.set_brake_mode_all(pros::E_MOTOR_BRAKE_HOLD);
    if (lock == Lock::RIGHT) right_motors.set_brake_mode_all(pros::E_MOTOR_BRAKE_HOLD);
    while (pros::millis() - t0 < timeout && !large.done && !small.done) {
        Pose p = get_pose();
        double target;
        if (toPoint) {
            p.theta = o.forwards ? std::fmod(p.theta, 360) : std::fmod(p.theta - 180, 360);
            target = std::fmod(rad2deg(M_PI / 2 - std::atan2(b - p.y, a - p.x)), 360);
        } else {
            if (lock != Lock::NONE) p.theta = std::fmod(p.theta, 360);
            target = a;
        }
        g_dist = std::fabs(angle_error(p.theta, startTheta, 360));
        const double raw = angle_error(target, p.theta, 360);
        if (!havePrev) prevRaw = raw;
        if (sgn(raw) != sgn(prevRaw)) settling = true;
        prevRaw = raw;
        const double delta = settling ? angle_error(target, p.theta, 360) : angle_error(target, p.theta, 360, o.direction);
        if (!havePrev) {
            prevDelta = delta;
            havePrev = true;
        }
        if (o.minSpeed != 0 && std::fabs(delta) < o.earlyExit) break;
        if (o.minSpeed != 0 && sgn(delta) != sgn(prevDelta)) break;
        double power = pid.update(delta);
        large.update(delta);
        small.update(delta);
        power = std::clamp(power, -o.maxSpeed, o.maxSpeed);
        if (std::fabs(delta) > 20) power = slew(power, prevPower, ANGULAR.slew);
        if (power < 0 && power > -o.minSpeed) power = -o.minSpeed;
        else if (power > 0 && power < o.minSpeed) power = o.minSpeed;
        prevPower = power;
        if (lock == Lock::LEFT) {
            right_motors.move(-power);
            left_motors.brake();
        } else if (lock == Lock::RIGHT) {
            left_motors.move(power);
            right_motors.brake();
        } else {
            drive(power, -power);
        }
        pros::delay(10);
    }
    left_motors.set_brake_mode_all(BRAKE_MODE);
    right_motors.set_brake_mode_all(BRAKE_MODE);
    drive(0, 0);
    g_dist = -1;
}

inline void turn_to_heading(double theta, int timeout, TurnOpts o = {}) { turn_impl(false, theta, 0, timeout, Lock::NONE, o); }
inline void turn_to_point(double x, double y, int timeout, TurnOpts o = {}) { turn_impl(true, x, y, timeout, Lock::NONE, o); }
inline void swing_to_heading(double theta, Lock lock, int timeout, TurnOpts o = {}) { turn_impl(false, theta, 0, timeout, lock, o); }

// ---------------------------------------------------------------- moveToPoint / moveToPose (boomerang)
struct MoveOpts {
    bool forwards = true;
    double horizontalDrift = 0;
    double lead = 0.6;
    double maxSpeed = 127;
    double minSpeed = 0;
    double earlyExit = 0;
};

inline void move_impl(bool isPose, double x, double y, double theta, int timeout, MoveOpts o) {
    PID lp(LATERAL), ap(ANGULAR);
    Exit lLarge{LATERAL.largeErr, LATERAL.largeT}, lSmall{LATERAL.smallErr, LATERAL.smallT};
    Exit aLarge{ANGULAR.largeErr, ANGULAR.largeT}, aSmall{ANGULAR.smallErr, ANGULAR.smallT};
    o.earlyExit = std::fabs(o.earlyExit);
    if (o.horizontalDrift == 0) o.horizontalDrift = HORIZONTAL_DRIFT;
    Pose last = get_pose();
    double tth;
    if (isPose) {
        tth = M_PI / 2 - deg2rad(theta);
        if (!o.forwards) tth = std::fmod(tth + M_PI, 2 * M_PI);
    } else {
        tth = std::atan2(y - last.y, x - last.x);
    }
    const int t0 = pros::millis();
    bool close = false, lateralSettled = false, prevSameSide = false, havePrevSide = false, prevSide = false;
    double prevLat = 0, prevAng = 0, maxSpeed = o.maxSpeed;
    g_dist = 0;
    while (pros::millis() - t0 < timeout) {
        if (!isPose && (lSmall.done || lLarge.done) && close) break;
        if (isPose && lateralSettled && (aLarge.done || aSmall.done) && close) break;
        const Pose gp = get_pose();
        const double px = gp.x, py = gp.y, pth = M_PI / 2 - deg2rad(gp.theta);
        g_dist += std::hypot(px - last.x, py - last.y);
        last = gp;
        const double distTarget = std::hypot(px - x, py - y);
        if (distTarget < 7.5 && !close) {
            close = true;
            maxSpeed = std::fmax(std::fabs(prevLat), 60);
        }
        double lat, ang;
        if (!isPose) {
            const bool side = (py - y) * -std::sin(tth) <= (px - x) * std::cos(tth) + o.earlyExit;
            if (!havePrevSide) {
                prevSide = side;
                havePrevSide = true;
            }
            if (side != prevSide && o.minSpeed != 0) break;
            prevSide = side;
            const double toTarget = std::atan2(y - py, x - px);
            const double adjusted = o.forwards ? pth : pth + M_PI;
            const double angErr = angle_error(adjusted, toTarget, 2 * M_PI);
            const double latErr = distTarget * std::cos(angle_error(pth, toTarget, 2 * M_PI));
            lSmall.update(latErr);
            lLarge.update(latErr);
            lat = lp.update(latErr);
            ang = ap.update(rad2deg(angErr));
            if (close) ang = 0;
            ang = std::clamp(ang, -maxSpeed, maxSpeed);
            ang = slew(ang, prevAng, ANGULAR.slew);
            lat = std::clamp(lat, -maxSpeed, maxSpeed);
            if (!close) lat = slew(lat, prevLat, LATERAL.slew);
        } else {
            if (lLarge.done && lSmall.done) lateralSettled = true;
            double cx = x - std::cos(tth) * o.lead * distTarget, cy = y - std::sin(tth) * o.lead * distTarget;
            if (close) {
                cx = x;
                cy = y;
            }
            const bool robotSide = (py - y) * -std::sin(tth) <= (px - x) * std::cos(tth) + o.earlyExit;
            const bool carrotSide = (cy - y) * -std::sin(tth) <= (cx - x) * std::cos(tth) + o.earlyExit;
            const bool sameSide = robotSide == carrotSide;
            if (!sameSide && prevSameSide && close && o.minSpeed != 0) break;
            prevSameSide = sameSide;
            const double toCarrot = std::atan2(cy - py, cx - px);
            const double adjusted = o.forwards ? pth : pth + M_PI;
            const double angErr = close ? angle_error(adjusted, tth, 2 * M_PI) : angle_error(adjusted, toCarrot, 2 * M_PI);
            double latErr = std::hypot(cx - px, cy - py);
            if (close) latErr *= std::cos(angle_error(pth, toCarrot, 2 * M_PI));
            else latErr *= sgn(std::cos(angle_error(pth, toCarrot, 2 * M_PI)));
            lSmall.update(latErr);
            lLarge.update(latErr);
            aSmall.update(rad2deg(angErr));
            aLarge.update(rad2deg(angErr));
            lat = lp.update(latErr);
            ang = ap.update(rad2deg(angErr));
            ang = std::clamp(ang, -maxSpeed, maxSpeed);
            lat = std::clamp(lat, -maxSpeed, maxSpeed);
            if (!close) lat = slew(lat, prevLat, LATERAL.slew);
            const double radius = 1 / std::fabs(curvature(px, py, pth, cx, cy));
            const double maxSlip = std::sqrt(o.horizontalDrift * radius * 9.8);
            lat = std::clamp(lat, -maxSlip, maxSlip);
            const double overturn = std::fabs(ang) + std::fabs(lat) - maxSpeed;
            if (overturn > 0) lat -= lat > 0 ? overturn : -overturn;
        }
        if (o.forwards && !close) lat = std::fmax(lat, 0);
        else if (!o.forwards && !close) lat = std::fmin(lat, 0);
        if (o.forwards && lat < std::fabs(o.minSpeed) && lat > 0) lat = std::fabs(o.minSpeed);
        if (!o.forwards && -lat < std::fabs(o.minSpeed) && lat < 0) lat = -std::fabs(o.minSpeed);
        prevAng = ang;
        prevLat = lat;
        double l = lat + ang, r = lat - ang;
        const double ratio = std::max(std::fabs(l), std::fabs(r)) / maxSpeed;
        if (ratio > 1) {
            l /= ratio;
            r /= ratio;
        }
        drive(l, r);
        pros::delay(10);
    }
    drive(0, 0);
    g_dist = -1;
}

inline void move_to_point(double x, double y, int timeout, MoveOpts o = {}) { move_impl(false, x, y, 0, timeout, o); }
inline void move_to_pose(double x, double y, double theta, int timeout, MoveOpts o = {}) { move_impl(true, x, y, theta, timeout, o); }

// ---------------------------------------------------------------- pure pursuit
inline double circle_intersect(double x1, double y1, double x2, double y2, double px, double py, double look) {
    const double dx = x2 - x1, dy = y2 - y1, fx = x1 - px, fy = y1 - py;
    const double a = dx * dx + dy * dy;
    const double b = 2 * (fx * dx + fy * dy);
    const double c = fx * fx + fy * fy - look * look;
    double disc = b * b - 4 * a * c;
    if (disc >= 0) {
        disc = std::sqrt(disc);
        const double t1 = (-b - disc) / (2 * a), t2 = (-b + disc) / (2 * a);
        if (t2 >= 0 && t2 <= 1) return t2;
        if (t1 >= 0 && t1 <= 1) return t1;
    }
    return -1;
}

inline void follow(const PathPt* path, int n, double lookahead, int timeout, bool forwards = true) {
    if (n == 0) return;
    double laX = path[0].x, laY = path[0].y;
    int laIdx = 0;
    double prevVel = 0;
    Pose last = get_pose();
    g_dist = 0;
    for (int i = 0; i < timeout / 10; i++) {
        Pose gp = get_pose();
        const double px = gp.x, py = gp.y;
        const double th = deg2rad(gp.theta) - (forwards ? 0 : M_PI); // heading, 0 = +y clockwise
        g_dist += std::hypot(px - last.x, py - last.y);
        last = gp;
        int closest = 0;
        double best = 1e30;
        for (int k = 0; k < n; k++) {
            const double d = std::hypot(px - path[k].x, py - path[k].y);
            if (d < best) {
                best = d;
                closest = k;
            }
        }
        if (path[closest].speed == 0) break;
        for (int k = std::max(closest, laIdx); k < n - 1; k++) {
            const double t = circle_intersect(path[k].x, path[k].y, path[k + 1].x, path[k + 1].y, px, py, lookahead);
            if (t != -1) {
                laX = path[k].x + (path[k + 1].x - path[k].x) * t;
                laY = path[k].y + (path[k + 1].y - path[k].y) * t;
                laIdx = k;
                break;
            }
        }
        const double curv = curvature(px, py, M_PI / 2 - th, laX, laY);
        double vel = slew(path[closest].speed, prevVel, LATERAL.slew);
        prevVel = vel;
        double l = vel * (2 + curv * TRACK_WIDTH) / 2, r = vel * (2 - curv * TRACK_WIDTH) / 2;
        const double ratio = std::max(std::fabs(l), std::fabs(r)) / 127;
        if (ratio > 1) {
            l /= ratio;
            r /= ratio;
        }
        if (forwards) drive(l, r);
        else drive(-r, -l);
        pros::delay(10);
    }
    drive(0, 0);
    g_dist = -1;
}

} // namespace gen
`;

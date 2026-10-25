#include "../src/effect_chain.hpp"

#include <cassert>
#include <cmath>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>

namespace {
class AffineProcessor final : public vttrig::MonoProcessor {
public:
  AffineProcessor(double scale, double offset) : scale_(scale), offset_(offset) {}
  void process(const vttrig::Sample* in, vttrig::Sample* out, int count) noexcept override {
    for (int i = 0; i < count; ++i) out[i] = in[i] * scale_ + offset_;
  }
private:
  double scale_;
  double offset_;
};

vttrig::Stage make_stage(std::string id, double scale, double offset) {
  return {std::move(id), "test", true, std::make_unique<AffineProcessor>(scale, offset)};
}
void near(double value, double expected) { assert(std::abs(value - expected) < 1e-10); }
}

int main() {
  vttrig::MonoChain graph;
  graph.append(make_stage("a", 1, 1)); // +1
  graph.append(make_stage("b", 2, 0)); // *2
  graph.append(make_stage("c", 1, -4)); // -4
  vttrig::Sample input[3]{1, 2, 3}, output[3]{};

  graph.process(input, output, 3);
  near(output[0], 0); // ((1+1)*2)-4 = 0
  near(output[1], 2);

  assert(graph.move("c", 0));
  graph.process(input, output, 3);
  near(output[0], -4); // ((1-4)+1)*2 = -4
  near(output[1], -2);

  assert(graph.set_enabled("b", false));
  graph.process(input, output, 3);
  near(output[0], -2); // (1-4)+1 = -2

  assert(graph.set_enabled("b", true));
  assert(graph.move("b", 0));
  graph.process(input, output, 3);
  near(output[0], -1); // ((1*2)-4)+1 = -1

  // Repeated *kinds* are allowed if each instance has a unique id.
  graph.append(make_stage("another-nam", 2, 0));
  assert(graph.size() == 4);
  assert(!graph.move("missing", 2));
  assert(!graph.set_enabled("missing", false));

  bool rejected_duplicate = false;
  try { graph.append(make_stage("a", 1, 1)); }
  catch (const std::invalid_argument&) { rejected_duplicate = true; }
  assert(rejected_duplicate);

  vttrig::MonoChain empty;
  empty.process(input, output, 3);
  near(output[0], 1);
  near(output[2], 3);

  vttrig::MonoChain muted;
  muted.append(make_stage("off", 0, 100));
  assert(muted.set_enabled("off", false));
  muted.process(input, output, 3);
  near(output[0], 1); // bypass means no transform

  // Reordering to the end is supported, not clamped to the old index.
  assert(graph.move("b", 999));
  assert(graph.stages().back().id == "b");

  std::cout << "VTTRIG effect-chain reorder/bypass tests passed\n";
  return 0;
}

#include "rf/scanner.hpp"
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
static unsigned checks=0;
#define CHECK(x) do { ++checks; if(!(x)){std::fprintf(stderr,"fault test line %d: %s\n",__LINE__,#x);std::exit(1);} } while(false)
struct FaultReceiver final : rf::Receiver {
    unsigned tune_count=0,read_count=0,fail_tune=0,fail_read=0;
    bool stopped=false;
    float value=-100;
    bool supports(const rf::Plan&) const override{return true;}
    bool tune(std::uint32_t) override{stopped=false;return ++tune_count!=fail_tune;}
    bool read(float& v) override{v=value;return ++read_count!=fail_read;}
    void standby() override{stopped=true;}
};
int main(){
    // Inject a driver fault at every acquisition position in the maximum-size sweep.
    for(unsigned position=1;position<=512;++position){
        for(unsigned kind=0;kind<2;++kind){
            FaultReceiver rx;rx.fail_tune=kind==0?position:0;rx.fail_read=kind==1?position:0;
            rf::Scanner scanner(rx);scanner.start({1,512,1,1},0);
            for(std::uint64_t now=1;scanner.state()==rf::State::scanning&&now<=513;++now)scanner.tick(now);
            CHECK(scanner.state()==rf::State::fault);CHECK(scanner.error()==rf::Error::driver);
            CHECK(rx.stopped);CHECK(scanner.size()==position-1);
            const auto reads=rx.read_count;scanner.tick(10000);CHECK(rx.read_count==reads);
            scanner.stop();rx.fail_read=rx.fail_tune=0;
            CHECK(scanner.start({1,1,1,1},20000)==rf::Error::ok);
            CHECK(scanner.tick(20001)==rf::Error::ok);CHECK(scanner.state()==rf::State::complete);
        }
    }
    for(float bad : {std::numeric_limits<float>::infinity(),-std::numeric_limits<float>::infinity(),-161.0F,21.0F}){
        FaultReceiver rx;rx.value=bad;rf::Scanner scanner(rx);scanner.start({1,1,1,1},0);
        CHECK(scanner.tick(1)==rf::Error::invalid_sample);CHECK(scanner.size()==0);CHECK(rx.stopped);
    }
    // Deterministic scheduler jitter: no fabricated burst and no read before settling.
    std::uint32_t seed=0x31415926U;
    for(unsigned cycle=0;cycle<1000;++cycle){
        FaultReceiver rx;rf::Scanner scanner(rx);std::uint64_t now=0,last_sample=0;
        scanner.start({1,32,1,20},now);
        while(scanner.state()==rf::State::scanning){seed=1664525U*seed+1013904223U;now+=seed%51U;
            const auto before=scanner.size();CHECK(scanner.tick(now)==rf::Error::ok);
            CHECK(scanner.size()<=before+1);
            if(scanner.size()>before){CHECK(now-last_sample>=20);last_sample=now;}
        }
        CHECK(scanner.size()==32);CHECK(rx.stopped);
    }
    std::printf("PASS: %u deterministic fault/jitter assertions (fake receiver; no hardware)\n",checks);
}

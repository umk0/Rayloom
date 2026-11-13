// SPDX-License-Identifier: GPL-2.0-or-later
// Side table: no change to RGBController layout or the public plugin ABI.
#pragma once
#include <chrono>
#include <deque>
#include <mutex>
#include <unordered_map>
#include <cstdint>
namespace lumen_metrics {
using Clock=std::chrono::steady_clock;
inline double Now(){return std::chrono::duration<double,std::milli>(Clock::now().time_since_epoch()).count();}
struct Sample {uint64_t updates=0;double first=0,last=0,totalMs=0,lastMs=0;std::deque<double> times;};
struct View {uint64_t updates=0;double driverFps=0,lastUpdateMs=0,averageMs=0,lastMs=0;};
inline std::mutex& Mutex(){static auto* m=new std::mutex;return *m;}
inline std::unordered_map<const void*,Sample>& Table(){static auto* t=new std::unordered_map<const void*,Sample>;return *t;}
inline void Record(const void* key,double elapsed){
 const double now=Now();std::lock_guard<std::mutex> lock(Mutex());auto& s=Table()[key];
 if(!s.updates)s.first=now;s.updates++;s.last=now;s.lastMs=elapsed;s.totalMs+=elapsed;s.times.push_back(now);
 while(!s.times.empty()&&s.times.front()<now-1000)s.times.pop_front();
}
inline View Get(const void* key){
 const double now=Now();std::lock_guard<std::mutex> lock(Mutex());auto it=Table().find(key);if(it==Table().end())return {};
 auto& s=it->second;while(!s.times.empty()&&s.times.front()<now-1000)s.times.pop_front();
 const double elapsed=now-s.first;const double seconds=elapsed<1000?elapsed/1000:1;
 return {s.updates,seconds>=.25?s.times.size()/seconds:0,now-s.last,s.totalMs/s.updates,s.lastMs};
}
inline void Forget(const void* key){std::lock_guard<std::mutex> lock(Mutex());Table().erase(key);}
}

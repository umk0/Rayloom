// SPDX-License-Identifier: GPL-2.0-or-later
// Per-controller latest pixels, consumed by the existing device thread. No plugin ABI changes.
#pragma once
#include <unordered_map>
#include <mutex>
#include <cstdint>
namespace lumen_frames {
using Pixels=std::unordered_map<unsigned int,uint32_t>;
struct State { Pixels pending; bool applying=false; };
// Device workers may outlive C++ static destruction. Registries have process lifetime;
// controller entries are removed after the corresponding worker has joined.
inline std::mutex& Mutex(){static auto* m=new std::mutex;return *m;}
inline std::unordered_map<const void*,State>& Table(){static auto* t=new std::unordered_map<const void*,State>;return *t;}
inline void Register(const void* key){std::lock_guard<std::mutex> lock(Mutex());Table().try_emplace(key);}
inline void Forget(const void* key){std::lock_guard<std::mutex> lock(Mutex());Table().erase(key);}
inline bool Queue(const void* key,const Pixels& pixels){std::lock_guard<std::mutex> lock(Mutex());auto it=Table().find(key);if(it==Table().end())return false;for(const auto& p:pixels)it->second.pending[p.first]=p.second;return true;}
inline bool Take(const void* key,Pixels& pixels){std::lock_guard<std::mutex> lock(Mutex());auto it=Table().find(key);if(it==Table().end()||it->second.pending.empty())return false;pixels.swap(it->second.pending);it->second.applying=true;return true;}
inline void Applied(const void* key){std::lock_guard<std::mutex> lock(Mutex());auto it=Table().find(key);if(it!=Table().end())it->second.applying=false;}
inline bool Busy(const void* key){std::lock_guard<std::mutex> lock(Mutex());auto it=Table().find(key);return it!=Table().end()&&(it->second.applying||!it->second.pending.empty());}
}

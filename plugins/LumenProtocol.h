// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <nlohmann/json.hpp>
#include <cstring>
#include <stdexcept>
namespace lumen {
using json=nlohmann::json;
template<class Fn> unsigned char* Reply(unsigned int id,unsigned char* data,unsigned int* size,Fn command) {
 if(id!=0x4C554D31)return nullptr;
 json response;
 try{if(!data||!size||*size>1024*1024)throw std::runtime_error("Invalid request size");response["result"]=command(json::parse(data,data+*size));}
 catch(const std::exception& e){response["error"]=e.what();}
 auto text=response.dump();auto* output=new unsigned char[text.size()];std::memcpy(output,text.data(),text.size());*size=static_cast<unsigned int>(text.size());return output;
}
inline void Number(const json& v,const char* key,double min,double max){if(!v.at(key).is_number()||v[key].get<double>()<min||v[key].get<double>()>max)throw std::runtime_error(std::string("Invalid ")+key);}
inline std::string Name(const json& v){auto s=v.get<std::string>();if(s.empty()||s.size()>100||s=="."||s==".."||s.find_first_of("/\\:*?\"<>|")!=std::string::npos||s.back()=='.'||s.back()==' ')throw std::runtime_error("Invalid name");return s;}
}

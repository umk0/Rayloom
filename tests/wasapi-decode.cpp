#include <windows.h>
#include <initguid.h>
#include "../plugins/effects/Audio/LumenWasapiCapture.h"
#include <cassert>
#include <limits>
int main(){
 const unsigned char negative16[]={0,128},positive16[]={255,127},negative24[]={0,0,128},negative32[]={0,0,0,128};
 assert(LumenWasapiCapture::Decode(negative16,16,false)==-1.f);
 assert(std::abs(LumenWasapiCapture::Decode(positive16,16,false)-.9999695f)<.00001f);
 assert(LumenWasapiCapture::Decode(negative24,24,false)==-1.f);
 assert(LumenWasapiCapture::Decode(negative32,32,false)==-1.f);
 float real=.25f;assert(LumenWasapiCapture::Decode(reinterpret_cast<unsigned char*>(&real),32,true)==.25f);
 double wide=-.5;assert(LumenWasapiCapture::Decode(reinterpret_cast<unsigned char*>(&wide),64,true)==-.5f);
 real=std::numeric_limits<float>::quiet_NaN();assert(LumenWasapiCapture::Decode(reinterpret_cast<unsigned char*>(&real),32,true)==0.f);
 const unsigned char zero8[]={128};assert(LumenWasapiCapture::Decode(zero8,8,false)==0.f);
}

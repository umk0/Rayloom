// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#ifdef _WIN32
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <mmreg.h>
#include <functiondiscoverykeys_devpkey.h>
#include <array>
#include <atomic>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>

// One WASAPI stream per endpoint. All COM creation, buffer acquisition and
// release happen on the capture thread. No samples are stored outside RAM.
class LumenWasapiCapture
{
public:
    struct Status{bool active=false;float peak=0;std::string error;};
    explicit LumenWasapiCapture(std::wstring endpoint,bool loopback):endpoint(endpoint),loopback(loopback){}
    ~LumenWasapiCapture(){Stop();}
    void Read(float* target)
    {
        std::lock_guard<std::mutex> guard(lifecycle);
        requested=Now();
        if(!running&&Now()>=retryAfter)
        {
            if(thread.joinable())thread.join();
            stop=false;running=true;thread=std::thread([this](){Run();retryAfter=State().error.empty()?0:Now()+1000;running=false;});
        }
        std::lock_guard<std::mutex> bufferGuard(bufferLock);
        std::copy(samples.begin(),samples.end(),target);
    }
    Status State(){std::lock_guard<std::mutex> guard(bufferLock);return status;}
    void Stop()
    {
        std::lock_guard<std::mutex> guard(lifecycle);stop=true;
        if(thread.joinable())thread.join();
        std::lock_guard<std::mutex> bufferGuard(bufferLock);status.active=false;status.peak=0;samples.fill(0);
    }
    static float Decode(const unsigned char* data,unsigned int bits,bool floating)
    {
        if(floating&&bits==32){float value;memcpy(&value,data,4);return std::isfinite(value)?value:0;}
        if(floating&&bits==64){double value;memcpy(&value,data,8);return std::isfinite(value)?static_cast<float>(value):0;}
        if(bits==8)return (static_cast<int>(*data)-128)/128.f;
        if(bits==16){int16_t value;memcpy(&value,data,2);return value/32768.f;}
        if(bits==24){int32_t value=data[0]|(data[1]<<8)|(data[2]<<16);if(value&0x800000)value|=~0xffffff;return value/8388608.f;}
        if(bits==32){int32_t value;memcpy(&value,data,4);return static_cast<float>(value/2147483648.);}
        return 0;
    }
private:
    static int64_t Now(){return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();}
    std::wstring endpoint;bool loopback;
    std::mutex lifecycle,bufferLock;std::thread thread;
    std::atomic<bool> running{false},stop{false};std::atomic<int64_t> requested{0},retryAfter{0};
    std::array<float,512> samples{};Status status;
    void Run()
    {
        const HRESULT initialized=CoInitializeEx(nullptr,COINIT_MULTITHREADED);
        IMMDeviceEnumerator* enumerator=nullptr;IMMDevice* device=nullptr;
        IAudioClient* client=nullptr;IAudioCaptureClient* capture=nullptr;WAVEFORMATEX* format=nullptr;
        auto cleanup=[&](){if(client)client->Stop();if(capture)capture->Release();if(client)client->Release();if(format)CoTaskMemFree(format);if(device)device->Release();if(enumerator)enumerator->Release();if(SUCCEEDED(initialized))CoUninitialize();std::lock_guard<std::mutex> guard(bufferLock);status.active=false;};
        auto failed=[&](HRESULT hr,const char* stage){if(SUCCEEDED(hr))return false;{std::lock_guard<std::mutex> guard(bufferLock);status.error=std::string(stage)+" ("+std::to_string(static_cast<unsigned long>(hr))+")";status.peak=0;samples.fill(0);}return true;};
        {std::lock_guard<std::mutex> guard(bufferLock);status={};samples.fill(0);}
        if(failed(initialized,"Audio initialization")){cleanup();return;}
        HRESULT hr=CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,__uuidof(IMMDeviceEnumerator),reinterpret_cast<void**>(&enumerator));
        if(failed(hr,"Audio devices")){cleanup();return;}
        hr=enumerator->GetDevice(endpoint.c_str(),&device);
        if(failed(hr,"Audio endpoint")){cleanup();return;}
        hr=device->Activate(__uuidof(IAudioClient),CLSCTX_ALL,nullptr,reinterpret_cast<void**>(&client));
        if(failed(hr,"Audio client")){cleanup();return;}
        if(failed(client->GetMixFormat(&format),"Audio format")){cleanup();return;}
        unsigned int tag=format->wFormatTag;
        if(tag==WAVE_FORMAT_EXTENSIBLE&&format->cbSize>=22)tag=reinterpret_cast<WAVEFORMATEXTENSIBLE*>(format)->SubFormat.Data1;
        const bool floating=tag==WAVE_FORMAT_IEEE_FLOAT;
        const unsigned int bits=format->wBitsPerSample,channels=format->nChannels,bytes=bits/8;
        if(!channels||channels>32||(!floating&&tag!=WAVE_FORMAT_PCM)||(!floating&&bits!=8&&bits!=16&&bits!=24&&bits!=32)||(floating&&bits!=32&&bits!=64)||format->nBlockAlign<bytes*channels)
        {failed(E_INVALIDARG,"Unsupported audio format");cleanup();return;}
        hr=client->Initialize(AUDCLNT_SHAREMODE_SHARED,loopback?AUDCLNT_STREAMFLAGS_LOOPBACK:0,0,0,format,nullptr);
        if(failed(hr,"Audio capture setup")){cleanup();return;}
        hr=client->GetService(__uuidof(IAudioCaptureClient),reinterpret_cast<void**>(&capture));
        if(failed(hr,"Audio capture service")||failed(client->Start(),"Audio capture start")){cleanup();return;}
        {std::lock_guard<std::mutex> guard(bufferLock);status.active=true;}
        std::array<float,512> history{};size_t cursor=0;unsigned int averaged=0;
        float accumulator=0;const unsigned int decimate=(std::max)(1U,static_cast<unsigned int>(format->nSamplesPerSec/12000U));
        int64_t lastPacket=Now();
        while(!stop&&Now()-requested<1000)
        {
            UINT32 packet=0;hr=capture->GetNextPacketSize(&packet);
            if(failed(hr,"Audio packet"))break;
            while(packet&&!stop)
            {
                BYTE* data=nullptr;UINT32 frames=0;DWORD flags=0;
                hr=capture->GetBuffer(&data,&frames,&flags,nullptr,nullptr);
                if(failed(hr,"Audio buffer")){stop=true;break;}
                if(hr==AUDCLNT_S_BUFFER_EMPTY)break;
                if(flags&AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY){history.fill(0);averaged=0;accumulator=0;}
                for(UINT32 frame=0;frame<frames;frame++)
                {
                    float mono=0;
                    if(data&&!(flags&AUDCLNT_BUFFERFLAGS_SILENT))
                        for(unsigned int channel=0;channel<channels;channel++)mono+=Decode(data+frame*format->nBlockAlign+channel*bytes,bits,floating)/channels;
                    accumulator+=mono;
                    if(++averaged==decimate){history[cursor]=accumulator/averaged;cursor=(cursor+1)%history.size();averaged=0;accumulator=0;}
                }
                lastPacket=Now();
                if(failed(capture->ReleaseBuffer(frames),"Release audio packet")){stop=true;break;}
                if(failed(capture->GetNextPacketSize(&packet),"Next audio packet")){stop=true;break;}
            }
            if(Now()-lastPacket>100)history.fill(0);
            {std::lock_guard<std::mutex> guard(bufferLock);status.peak=0;for(size_t i=0;i<history.size();i++){samples[i]=history[(cursor+i)%history.size()];status.peak=(std::max)(status.peak,std::abs(samples[i]));}}
            std::this_thread::sleep_for(std::chrono::milliseconds(8));
        }
        cleanup();
    }
};
#endif

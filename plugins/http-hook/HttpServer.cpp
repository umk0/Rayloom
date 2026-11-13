/*---------------------------------------------------------*\
| HttpServer.cpp                                            |
|                                                           |
|   HTTP server for the plugin                              |
|                                                           |
|   This file is part of the OpenRGB Http Hook Plugin       |
|   project                                                 |
|   SPDX-License-Identifier: GPL-2.0-or-later               |
\*---------------------------------------------------------*/

#include "HttpServer.h"

HttpServer::HttpServer(){}

void HttpServer::SetHookCallback(std::function<bool(std::string, std::string)> callback)
{
    this->callback = callback;

}
void HttpServer::SetupRoute()
{
    svr.Post(R"(/([^/]*))", [&](const httplib::Request& req, httplib::Response& res) {
        std::string path = req.matches[1];
        bool has_ran = callback("POST", path);
        res.status = has_ran ? 204 : 404;
        printf("[OpenRGBHttpHookPlugin] [%d] POST /%s\n", res.status, path.c_str());
    });

    svr.Get(R"(/([^/]*))", [&](const httplib::Request& req, httplib::Response& res) {
        std::string path = req.matches[1];
        bool has_ran = callback("GET", path);
        res.status = has_ran ? 204 : 404;
        printf("[OpenRGBHttpHookPlugin] [%d] GET /%s\n", res.status, path.c_str());
    });
}

void HttpServer::Start(std::string ip, int port)
{
    if(t != nullptr)
    {
        Stop();
    }

    this->ip = ip;
    this->port = port;

    t = new std::thread(&HttpServer::ThreadFunction, this);
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
}

void HttpServer::Stop()
{
    svr.stop();

    if(t != nullptr)
    {
        t->join();
        delete t;
        t = nullptr;
    }
}

bool HttpServer::State()
{
    return svr.is_running();
}

void HttpServer::ThreadFunction()
{
    printf("Server thread starting\n");

    svr.listen(ip.c_str(), port);

    printf("Server thread released\n");
}

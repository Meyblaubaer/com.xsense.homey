##Reviewer

Dear Sven-Christian Meyhoefer,

Thank you for submitting your app X-Sense for review.

Unfortunately, your app has not passed the certification process, due to the following:

— The app image is distorted, it seems like it was only adjusted in hight, making it appear a bit cramped. Have a look if you can adjust the resolution of the image without compromising the shape and form. 

— The new driver image for the Mailbox Alarm and Heat alarm are identical to previously used images for the smoke alarm. Please provide individual images that shows the device itself on white background. 

— The same applies to the Driver Icon of the new drivers. Make sure the icon depicts the device itself. 
Please check our Guidelines for more information on these topics: 
https://apps.developer.homey.app/app-store/guidelines

Once you have solved these issues, you can submit a new version for certification again.


##Users

#1
App ID
com.xsense.svenm

App Version
v1.0.2

Homey Version
v12.10.1

Homey Model ID
homey5q

Homey Model Name
Homey Pro (Early 2023)

Stack Trace
Note: this log has been manually submitted by a user.
    Log ID: 3bd36e35-abca-4861-a7ea-8f98dbc1339c

    User Message:
    Temperature and humidity sensors show no temperature and humidity data.

    stdout:
            "deviceName": "Salon",
        "deviceType": "STH51",
        "roomId": "03EA7DBCE94C11F0B539F5DFDBD02C02"
      },
      {
        "deviceId": "E802F543E97411F08F66F7EAC549006E",
        "deviceSn": "00000003",
        "deviceName": "Chambre Parentale",
        "deviceType": "STH51",
        "roomId": "03E47BDEE94C11F09BE1F5DFDBD02C02"
      },
      {
        "deviceId": "8A0C7DF4E97511F09381593454A0DFD3",
        "deviceSn": "00000004",
        "deviceName": "Chambre Samuel",
        "deviceType": "STH51",
        "roomId": "03E78034E94C11F08EC3F5DFDBD02C02"
      }
    ],
    "deviceSort": [
      "46B76116E97311F0B90A272918A877D1",
      "16D01C6EE97411F09ECD25431AE23419",
      "E802F543E97411F08F66F7EAC549006E",
      "8A0C7DF4E97511F09381593454A0DFD3"
    ]
  }
]
[XSenseAPI] SUCCESS: Found shadow! Thing=SBS5015AA3799, Shadow=2nd_mainpage
[XSenseAPI] SUCCESS: Found shadow! Thing=SBS5015AA3799, Shadow=2nd_systime
[XSenseAPI] Found 4 devices in 1 stations
[XSenseAPI] Fetching all devices (Optimized)...
[XSenseAPI] Calculated MAC for params: { utctimestamp: '0' } => deecea6ba9b710fb12f12f8e63736093
[XSenseAPI] Calling bizCode 102007 with params: {"utctimestamp":"0"}
[XSenseAPI] Response status: 200
[XSenseAPI] Response data: {"reCode":200,"reMsg":"success !","cntVersion":"5","zoneVersion":"20250714001","cfgVersion":{"identityEnable":"1","deviceControl":"18","alertSwitchSkill":"0","isAllowRating":"0"},"reData":[{"houseId":"03DE93F4E94C11F08157F5DFDBD02C02","houseName":"Villenave","houseRegion":"France","mqttRegion":"eu-central-1","mqttServer":"eu-central-1.x-sense-iot.com","loraBand":"868","houseOrigin":0,"createTime":"20260104090154"},{"houseId":"EAD93680E7EF11F0A97F075C8FCCC962","houseName":"Montcaret","houseRegion
[XSenseAPI] Calculated MAC for params: { houseId: '03DE93F4E94C11F08157F5DFDBD02C02', utctimestamp: '0' } => 10877f901ff3145df001e63abd381b11
[XSenseAPI] Calling bizCode 103007 with params: {"houseId":"03DE93F4E94C11F08157F5DFDBD02C02","utctimestamp":"0"}
[XSenseAPI] Response status: 200
[XSenseAPI] Response data: {"reCode":200,"reMsg":"success !","cntVersion":"5","zoneVersion":"20250714001","cfgVersion":{"identityEnable":"1","deviceControl":"18","alertSwitchSkill":"0","isAllowRating":"0"},"reData":{"houseId":"03DE93F4E94C11F08157F5DFDBD02C02","stations":[{"stationId":"BBCEF726E97211F0B5ABCD84C1EE9312","stationSn":"15AA3799","stationName":"Station de base","category":"SBS50","roomId":"03EA7DBCE94C11F0B539F5DFDBD02C02","safeMode":"Disarmed","onLine":1,"onLineTime":1767541418044,"userId":"4d712ac7-3448-4e93
[XSenseAPI] Stations data: [
  {
    "stationId": "BBCEF726E97211F0B5ABCD84C1EE9312",
    "stationSn": "15AA3799",
    "stationName": "Station de base",
    "category": "SBS50",
    "roomId": "03EA7DBCE94C11F0B539F5DFDBD02C02",
    "safeMode": "Disarmed",
    "onLine": 1,
    "onLineTime": 1767541418044,
    "userId": "4d712ac7-3448-4e93-bfa1-0aca5426f2fd",
    "userName": "sebastian.wloch@gmail.com",
    "groupList": [],
    "timeZoneEnabled": "1",
    "timeZoneValid": "1",
    "zoneName": "Europe/Paris",
    "cityName": "Nice",
    "timeZone": "CET-1CEST,M3.5.0,M10.5.0/3",
    "isFireDrill": "0",
    "sbs50Sw": "v1.6.9",
    "devices": [
      {
        "deviceId": "46B76116E97311F0B90A272918A877D1",
        "deviceSn": "00000001",
        "deviceName": "Garage",
        "deviceType": "STH51",
        "roomId": "03EB8E87E94C11F0BD83F5DFDBD02C02"
      },
      {
        "deviceId": "16D01C6EE97411F09ECD25431AE23419",
        "deviceSn": "00000002",
        "deviceName": "Salon",
        "deviceType": "STH51",
        "roomId": "03EA7DBCE94C11F0B539F5DFDBD02C02"
      },
      {
        "deviceId": "E802F543E97411F08F66F7EAC549006E",
        "deviceSn": "00000003",
        "deviceName": "Chambre Parentale",
        "deviceType": "STH51",
        "roomId": "03E47BDEE94C11F09BE1F5DFDBD02C02"
      },
      {
        "deviceId": "8A0C7DF4E97511F09381593454A0DFD3",
        "deviceSn": "00000004",
        "deviceName": "Chambre Samuel",
        "deviceType": "STH51",
        "roomId": "03E78034E94C11F08EC3F5DFDBD02C02"
      }
    ],
    "deviceSort": [
      "46B76116E97311F0B90A272918A877D1",
      "16D01C6EE97411F09ECD25431AE23419",
      "E802F543E97411F08F66F7EAC549006E",
      "8A0C7DF4E97511F09381593454A0DFD3"
    ]
  }
]
[XSenseAPI] Trying userId 4d712ac7-3448-4e93-bfa1-0aca5426f2fd as ThingName for House 03DE93F4E94C11F08157F5DFDBD02C02
[XSenseAPI] Calculated MAC for params: { houseId: '03DE93F4E94C11F08157F5DFDBD02C02', utctimestamp: '0' } => 10877f901ff3145df001e63abd381b11
[XSenseAPI] Calling bizCode 103007 with params: {"houseId":"03DE93F4E94C11F08157F5DFDBD02C02","utctimestamp":"0"}

    stderr:
    n/a
    
    
#2
“Hai Sven with version 1.2 i can add temperature and hydro. But is doesnt show the temperature or hydro after adding. Account and password isnot remembered in the app. Api error 500: not authorised exception when i want to add Smoke detector. Water leak reports failed to retrieve diveces. ”

#3
“Xsense SC07-WX Is it possible to transmit the CO value to Homey? Regards, Undertaker (Uwe)”

#4

 
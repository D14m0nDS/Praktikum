#include <SPI.h>
#include <MFRC522.h>
#include <SoftwareSerial.h>

#define REED_PIN 2
#define LED_PIN 4
#define BUZZER_PIN 5

#define WIFI_RX_PIN 6   // Arduino RX  <- ESP TX
#define WIFI_TX_PIN 7   // Arduino TX  -> ESP RX

#define SS_PIN 10
#define RST_PIN 9

MFRC522 rfid(SS_PIN, RST_PIN);
SoftwareSerial esp(WIFI_RX_PIN, WIFI_TX_PIN);

const long ESP8266_BAUD = 9600;

// При твоя текущ setup:
// магнит = OPEN
// без магнит = CLOSED
const int DOOR_OPEN_STATE = HIGH;

// Wi-Fi + backend
const char* WIFI_SSID = "VIVACOM_FiberNet_0396";
const char* WIFI_PASS = "0224617049";
const char* BACKEND_HOST = "192.168.1.6";
const int BACKEND_PORT = 5000;

static const char* PATH_CHECK = "/api/cards/check";
static const char* PATH_LOG = "/api/logs";

enum SystemState { IDLE, WAITING_FOR_CARD, ALARM };
SystemState state = IDLE;

unsigned long doorOpenTime = 0;
bool prevDoorOpen = false;
bool accessGranted = false;
String lastScannedUid = "";

// ---------- Hardware ----------
void setAlarm(bool on) {
  digitalWrite(LED_PIN, on ? HIGH : LOW);
  digitalWrite(BUZZER_PIN, on ? HIGH : LOW);
}

void blinkAlarm() {
  bool on = (millis() % 500) < 250;
  setAlarm(on);
}

bool readDoorStable() {
  return (digitalRead(REED_PIN) == DOOR_OPEN_STATE);
}

String uidToString() {
  String uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  return uid;
}

// ---------- ESP ----------
void sendCommand(const String& cmd) {
  esp.println(cmd);
}

bool waitForResponse(const char* target, unsigned long timeoutMs) {
  unsigned long start = millis();
  String response = "";

  while (millis() - start < timeoutMs) {
    while (esp.available()) {
      char c = esp.read();
      response += c;
      if (response.indexOf(target) != -1) return true;
    }
  }

  return false;
}

String readFullResponse(unsigned long timeoutMs) {
  unsigned long start = millis();
  String response = "";

  while (millis() - start < timeoutMs) {
    while (esp.available()) {
      char c = esp.read();
      response += c;
    }
  }

  return response;
}

bool connectWiFi() {
  Serial.println("Connecting WiFi...");

  sendCommand("AT");
  if (!waitForResponse("OK", 3000)) {
    Serial.println("WiFi: ESP not responding");
    return false;
  }

  sendCommand("AT+CWMODE=1");
  if (!waitForResponse("OK", 3000)) {
    Serial.println("WiFi: mode set failed");
    return false;
  }

  String cmd = "AT+CWJAP=\"";
  cmd += WIFI_SSID;
  cmd += "\",\"";
  cmd += WIFI_PASS;
  cmd += "\"";

  sendCommand(cmd);
  if (!waitForResponse("WIFI GOT IP", 20000)) {
    Serial.println("WiFi: connect failed");
    return false;
  }

  Serial.println("WiFi connected");
  return true;
}

bool httpPostJson(const char* path, const String& body, const char* label) {
  Serial.print("Sending: ");
  Serial.println(label);

  String req = String("POST ") + path + " HTTP/1.1\r\n" +
               "Host: " + BACKEND_HOST + ":" + String(BACKEND_PORT) + "\r\n" +
               "Content-Type: application/json\r\n" +
               "Content-Length: " + String(body.length()) + "\r\n" +
               "Connection: close\r\n\r\n" +
               body;

  String startCmd =
      "AT+CIPSTART=\"TCP\",\"" + String(BACKEND_HOST) + "\"," + String(BACKEND_PORT);
  sendCommand(startCmd);

  if (!waitForResponse("CONNECT", 4000) && !waitForResponse("OK", 4000)) {
    Serial.print(label);
    Serial.println(": connect fail");
    return false;
  }

  sendCommand("AT+CIPSEND=" + String(req.length()));
  if (!waitForResponse(">", 3000)) {
    Serial.print(label);
    Serial.println(": send fail");
    return false;
  }

  esp.print(req);
  String resp = readFullResponse(2500);

  sendCommand("AT+CIPCLOSE");

  if (resp.indexOf("201 CREATED") >= 0 || resp.indexOf("200 OK") >= 0) {
    Serial.print(label);
    Serial.println(": OK");
    return true;
  } else {
    Serial.print(label);
    Serial.println(": FAIL");
    return false;
  }
}

// ---------- Setup ----------
void setup() {
  Serial.begin(115200);
  esp.begin(ESP8266_BAUD);

  pinMode(REED_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  SPI.begin();
  rfid.PCD_Init();
  rfid.PCD_AntennaOn();

  setAlarm(false);

  Serial.println("Door monitor - starting");

  if (connectWiFi()) {
    Serial.println("System ready");
  } else {
    Serial.println("WiFi failed");
  }
}

// ---------- Loop ----------
void loop() {
  bool doorOpen = readDoorStable();

  // Print only on state change
  static bool lastPrinted = false;
  static bool firstPrint = true;
  if (firstPrint || doorOpen != lastPrinted) {
    Serial.print("Door: ");
    Serial.println(doorOpen ? "OPEN" : "CLOSED");
    lastPrinted = doorOpen;
    firstPrint = false;
  }

  // Door opened
  if (doorOpen && !prevDoorOpen) {
    Serial.println("Door opened -> waiting for card");
    state = WAITING_FOR_CARD;
    accessGranted = false;
    doorOpenTime = millis();
    httpPostJson(PATH_LOG, "{\"event\":\"door_open\"}", "log door_open");
  }

  // Door closed
  if (!doorOpen && prevDoorOpen) {
    Serial.println("Door closed");
    httpPostJson(PATH_LOG, "{\"event\":\"door_closed\"}", "log door_closed");
  }

  prevDoorOpen = doorOpen;

  // RFID
  if (rfid.PICC_IsNewCardPresent()) {
    Serial.println("Card present detected");

    if (rfid.PICC_ReadCardSerial()) {
      String uid = uidToString();
      lastScannedUid = uid;

      Serial.print("Card UID: ");
      Serial.println(uid);

      String body = "{\"uid\":\"" + uid + "\"}";
      httpPostJson(PATH_CHECK, body, "card check");

      // Временно за тест: приемаме винаги позволено
      accessGranted = true;

      if (accessGranted) {
        Serial.println("ACCESS GRANTED");
        state = IDLE;
        setAlarm(false);

        httpPostJson(
          PATH_LOG,
          "{\"event\":\"access_granted\",\"uid\":\"" + uid + "\"}",
          "log access_granted"
        );
      }

      rfid.PICC_HaltA();
      rfid.PCD_StopCrypto1();
    } else {
      Serial.println("Card present but read failed");
    }
  }

  // Waiting state
  if (state == WAITING_FOR_CARD) {
    if (!accessGranted) {
      if (millis() - doorOpenTime < 10000) {
        blinkAlarm();
      } else {
        Serial.println("Timeout -> ALARM");
        state = ALARM;
        setAlarm(true);
        httpPostJson(PATH_LOG, "{\"event\":\"alarm\"}", "log alarm");
      }
    }
  }

  // Alarm state
  if (state == ALARM) {
    setAlarm(true);
  }

  // Idle state
  if (state == IDLE) {
    setAlarm(false);
  }
}
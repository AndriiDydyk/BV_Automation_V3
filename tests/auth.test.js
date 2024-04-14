const request = require("supertest");
const { before } = require("mocha");
const Worker = require("../helper/worker");
const CryptoManager = require("../helper/cryptoManager");
const Ajv = require("ajv");
const { expect } = require("chai");

const ajv = new Ajv();
const worker = new Worker();
const cryptoManager = new CryptoManager();

describe("", function () {
  let env;
  let host;
  let device;
  let phoneNumber;
  let otp;
  let password;

  before(async () => {
    const config = await worker.loadEnvironments();
    env = config.prod;

    host = env.host;
    phoneNumber = env.phoneNumber;
    otp = env.otp;
    password = env.password;
    device = env.device;
  });

  describe("Авторизація", function () {
    let clientPublicKey;

    before(async () => {
      await worker.loadKeys();

      clientPublicKey = await worker.getSessionValue("clientPublicKey");
    });

    describe("POST /start", function () {
      let response;

      before(async () => {
        response = await request(host).post("/auth/v3/start").send({
          clientPublicKey,
          phoneNumber,
          device,
        });

        const { token, serverPublicKey, cryptogram } = response.body;

        await worker.setMultipleSessionValues({
          token,
          serverPublicKey,
          cryptogram,
        });
      });

      it("should return 200 OK status code", function () {
        expect(response.statusCode).to.equal(200);
      });
    });

    describe("POST /nextStep", function () {
      let response;

      before(async () => {
        const token = await worker.getSessionValue("token");

        const encryptData = await cryptoManager.encryptAndSign({});

        response = await request(host)
          .post("/auth/v4/nextstep")
          .set("Authorization", `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram,
          });

        const { cryptogram, nextStep } = response.body;

        await worker.setMultipleSessionValues({
          cryptogram,
          nextStep,
        });
      });

      it("should return 200 OK status code", function () {
        expect(response.statusCode).to.equal(200);
      });
    });

    describe("POST /otp/confirm", function () {
      let response;

      before(async () => {
        const nextStep = await worker.getSessionValue("nextStep");
        if (nextStep !== "requestOtp") {
          return;
        }

        const token = await worker.getSessionValue("token");
        const encryptData = await cryptoManager.encryptAndSign({ otp });

        response = await request(host)
          .post("/auth/v4/otp/confirm")
          .set("Authorization", `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram,
          });

        await worker.setMultipleSessionValues({
          cryptogram: response.body.cryptogram,
          nextStep: response.body.nextStep,
        });
      });

      it("should return 200 OK status code", function () {
        if (!response) {
          this.skip();
        }
        expect(response.statusCode).to.equal(200);
      });
    });

    describe("POST /enterpassword", function () {
      let response;

      before(async () => {
        const nextStep = await worker.getSessionValue("nextStep");
        if (nextStep !== "enterPassword") {
          return;
        }

        const token = await worker.getSessionValue("token");
        const encryptData = await cryptoManager.encryptAndSign({ password });

        response = await request(host)
          .post("/auth/v3/enterpassword")
          .set("Authorization", `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram,
          });

        await worker.setSessionValue("token", response.body.token);
      });

      it("should return 200 OK status code", function () {
        if (!response) {
          this.skip();
        }
        expect(response.statusCode).to.equal(200);
      });
    });
  });

  describe("Дашборд", function () {
    let token;
    let response;
    before(async () => {
      token = await worker.getSessionValue("token");
    });

    describe("GET /cards", function () {
      before(async () => {
        response = await request(host)
          .get("/cards/v3?forceCacheReload=true")
          .set("Authorization", `Bearer ${token}`)
          .send();

        await worker.setSessionValue("cardAccounts", response.body);
      });

      it("should return 200 OK status code", function () {
        expect(response.statusCode).to.equal(200);
      });
    });
  });

  describe.skip("Переказ з іншої картки", function () {
    let token;
    let password;
    let recipientCard;
    let recipientCardName;
    let recipientCardNumber;
    let amount;

    before(async () => {
      token = await worker.getSessionValue("token");
      const cardAccounts = await worker.getSessionValue("cardAccounts");
      const data = await worker.loadData();

      password = data.password;
      recipientCardName = data.payerCardName;
      recipientCard = await worker.findCardByName(
        cardAccounts,
        recipientCardName,
      );
      recipientCardNumber = recipientCard.cards[0].cardNumber;
    });

    describe("БВР(вручну) => Власна БВ", function () {
      let payerCardNumber;
      let payerCardExpiryDate;
      let payerCardCvv;

      before(async () => {
        await worker.waitForTime(2000);
        const data = await worker.loadData();

        payerCardNumber = data.ownBVRCardNumber;
        payerCardExpiryDate = data.ownBVRExpiryDate;
        payerCardCvv = data.ownBVRCvv;
        amount = await worker.randomAmount();
      });

      describe("GET /p2p/markup", function () {
        let response;

        before(async () => {
          response = await request(host)
            .get("/payments/p2p/markup")
            .set("Authorization", `Bearer ${token}`)
            .send();

          await worker.setMultipleSessionValues({
            cryptogram: response.body.cryptogram,
            sessionGuid: response.body.sessionGuid,
          });
        });

        it("should return 200 OK status code", function () {
          expect(response.statusCode).to.equal(200);
        });
      });

      describe("POST /p2p/setInput", function () {
        let response;

        before(async function () {
          const sessionGuid = await worker.getSessionValue("sessionGuid");

          const encryptData = await cryptoManager.encryptAndSign({
            cvv: payerCardCvv,
            expiryDate: payerCardExpiryDate,
          });

          response = await request(host)
            .post("/payments/p2p/setInput")
            .set("Authorization", `Bearer ${token}`)
            .send({
              sign: encryptData.sign,
              cryptogram: encryptData.cryptogram,
              sessionGuid,
              payerId: `cardNumber:${payerCardNumber}`,
              recipientId: `cardNumber:${recipientCard.cards[0].cardNumber}`,
              amount,
            });

          if (response.body["3ds"]) {
            await worker.openInBrowser(response.body["3ds"].url);
            await worker.waitForTime(20000);
          }
          await worker.setSessionValue("cryptogram", response.body.cryptogram);
        });

        it("should return 200 OK status code", function () {
          expect(response.statusCode).to.equal(200);
        });
      });

      describe("GET /p2p/commission", function () {
        let response;

        before(async () => {
          response = await request(host)
            .get("/payments/p2p/commission")
            .set("Authorization", `Bearer ${token}`)
            .send();
        });

        it("should return 200 OK status code", function () {
          expect(response.statusCode).to.equal(200);
        });
      });

      describe("POST /p2p/confirm", function () {
        let response;

        before(async function () {
          const sessionGuid = await worker.getSessionValue("sessionGuid");

          const encryptData = await cryptoManager.encryptAndSign({
            password,
          });

          response = await request(host)
            .post("/payments/p2p/confirm")
            .set("Authorization", `Bearer ${token}`)
            .send({
              sign: encryptData.sign,
              cryptogram: encryptData.cryptogram,
              sessionGuid,
            });

          await worker.setSessionValue("cryptogram", response.body.cryptogram);
        });

        it("should return 200 OK status code", function () {
          expect(response.statusCode).to.equal(200);
        });

        it("should be ability to save card as template", function () {
          expect(response.body.hasCardToSave).to.equal(true);
          expect(response.body).to.has.property("cardToSave");
        });

        it("should have correct recipientContractId", function () {
          expect(response.body.recipientContractId).to.equal(
            recipientCard.contractId,
          );
        });

        it("should have property 'operation'", function () {
          expect(response.body).to.has.property("operation");
        });

        it("operation should have correct title", function () {
          expect(response.body.operation.title).to.equal(
            "Переказ з картки на картку",
          );
        });

        it("operation should have correct subtitle", function () {
          expect(response.body.operation.subtitle).to.equal(
            "Переказ з картки на картку",
          );
        });

        it("operation should have status 'processing'", function () {
          expect(response.body.operation.status).to.equal("processing");
        });

        it("operation should have correct darkIcon", function () {
          expect(response.body.operation.darkIcon).to.equal(
            "https://content.vostok.bank/vostokApp/payment-history/categories/logos/TransferCard-Dark.png",
          );
        });

        it("operation should have correct lightIcon", function () {
          expect(response.body.operation.lightIcon).to.equal(
            "https://content.vostok.bank/vostokApp/payment-history/categories/logos/TransferCard-Light.png",
          );
        });
      });
    });

    describe("БВР (шаблон) => Власна БВ", function () {
      let payerTemplateName;
      let payerCardCvv;
      let payerCardGuid;

      before(async () => {
        await worker.waitForTime(2000);
        const data = await worker.loadData();

        payerTemplateName = data.ownBVRTemplateName;
        payerCardCvv = data.ownBVRCvv;
        amount = await worker.randomAmount();
      });

      describe("GET /p2p/markup", function () {
        let response;

        before(async () => {
          response = await request(host)
            .get("/payments/p2p/markup")
            .set("Authorization", `Bearer ${token}`)
            .send();

          await worker.setMultipleSessionValues({
            cryptogram: response.body.cryptogram,
            sessionGuid: response.body.sessionGuid,
          });
        });

        it("should return 200 OK status code", function () {
          expect(response.statusCode).to.equal(200);
        });
      });

      describe("GET /savedcards", function () {
        let response;

        before(async () => {
          response = await request(host)
            .get("/payments/savedcards")
            .set("Authorization", `Bearer ${token}`)
            .send();

          await worker.setMultipleSessionValues({
            transferFrom: response.body.transferFrom,
            transferTo: response.body.transferTo,
          });
        });

        it("should return 200 OK status code", function () {
          expect(response.statusCode).to.equal(200);
        });
      });

      describe("POST /p2p/setInput", function () {
        let response;

        before(async function () {
          const sessionGuid = await worker.getSessionValue("sessionGuid");
          const transferFrom = await worker.getSessionValue("transferFrom");
          const payerTemplate = await transferFrom.find(
            (item) => item.name === payerTemplateName,
          );

          payerCardGuid = payerTemplate.guid;

          const encryptData = await cryptoManager.encryptAndSign({
            cvv: payerCardCvv,
          });

          response = await request(host)
            .post("/payments/p2p/setInput")
            .set("Authorization", `Bearer ${token}`)
            .send({
              sign: encryptData.sign,
              cryptogram: encryptData.cryptogram,
              sessionGuid,
              payerId: `cardGuid:${payerCardGuid}`,
              recipientId: `cardNumber:${recipientCard.cards[0].cardNumber}`,
              amount,
            });

          if (response.body["3ds"]) {
            await worker.openInBrowser(response.body["3ds"].url);
            await worker.waitForTime(20000);
          }

          await worker.setSessionValue("cryptogram", response.body.cryptogram);
        });

        it("should return 200 OK status code", function () {
          expect(response.statusCode).to.equal(200);
        });
      });

      describe("GET /p2p/commission", function () {
        let response;

        before(async () => {
          response = await request(host)
            .get("/payments/p2p/commission")
            .set("Authorization", `Bearer ${token}`)
            .send();
        });

        it("should return 200 OK status code", function () {
          expect(response.statusCode).to.equal(200);
        });
      });

      describe("POST /p2p/confirm", function () {
        let response;

        before(async function () {
          const sessionGuid = await worker.getSessionValue("sessionGuid");

          const encryptData = await cryptoManager.encryptAndSign({
            password,
          });

          response = await request(host)
            .post("/payments/p2p/confirm")
            .set("Authorization", `Bearer ${token}`)
            .send({
              sign: encryptData.sign,
              cryptogram: encryptData.cryptogram,
              sessionGuid,
            });

          await worker.setSessionValue("cryptogram", response.body.cryptogram);
        });

        it("should return 200 OK status code", function () {
          expect(response.statusCode).to.equal(200);
        });

        it("should do not have ability to save card as template", function () {
          expect(response.body.hasCardToSave).to.equal(false);
        });

        it("should have correct recipientContractId", function () {
          expect(response.body.recipientContractId).to.equal(
            recipientCard.contractId,
          );
        });

        it("should have property 'operation'", function () {
          expect(response.body).to.has.property("operation");
        });

        it("operation should have correct title", function () {
          expect(response.body.operation.title).to.equal(
            "Переказ з картки на картку",
          );
        });

        it("operation should have correct subtitle", function () {
          expect(response.body.operation.subtitle).to.equal(
            "Переказ з картки на картку",
          );
        });

        it("operation should have status 'processing'", function () {
          expect(response.body.operation.status).to.equal("processing");
        });

        it("operation should have correct darkIcon", function () {
          expect(response.body.operation.darkIcon).to.equal(
            "https://content.vostok.bank/vostokApp/payment-history/categories/logos/TransferCard-Dark.png",
          );
        });

        it("operation should have correct lightIcon", function () {
          expect(response.body.operation.lightIcon).to.equal(
            "https://content.vostok.bank/vostokApp/payment-history/categories/logos/TransferCard-Light.png",
          );
        });
      });
    });

    describe("БВ (вручну) => Власна БВ", function () {
      let payerCardNumber;
      let payerCardExpiryDate;
      let payerCardCvv;

      before(async () => {
        const data = await worker.loadData();
        payerCardNumber = data.otherBankVostokCardNumber;
        payerCardExpiryDate = data.otherBankVostokExpiryDate;
        payerCardCvv = data.otherBankVostokCVV;
        amount = await worker.randomAmount();
      });

      describe("GET /p2p/markup", function () {
        let response;

        before(async () => {
          response = await request(host)
            .get("/payments/p2p/markup")
            .set("Authorization", `Bearer ${token}`)
            .send();

          await worker.setMultipleSessionValues({
            cryptogram: response.body.cryptogram,
            sessionGuid: response.body.sessionGuid,
          });
        });

        it("should return 200 OK status code", function () {
          expect(response.statusCode).to.equal(200);
        });
      });

      describe("POST /p2p/setInput", function () {
        let response;

        before(async function () {
          const sessionGuid = await worker.getSessionValue("sessionGuid");

          const encryptData = await cryptoManager.encryptAndSign({
            cvv: payerCardCvv,
            expiryDate: payerCardExpiryDate,
          });

          response = await request(host)
            .post("/payments/p2p/setInput")
            .set("Authorization", `Bearer ${token}`)
            .send({
              sign: encryptData.sign,
              cryptogram: encryptData.cryptogram,
              sessionGuid,
              payerId: `cardNumber:${payerCardNumber}`,
              recipientId: `cardNumber:${recipientCardNumber}`,
              amount,
            });

          if (response.body["3ds"]) {
            await worker.openInBrowser(response.body["3ds"].url, "safari");
            await worker.waitForTime(20000);
          }
          await worker.setSessionValue("cryptogram", response.body.cryptogram);
        });

        it("should return 200 OK status code", function () {
          expect(response.statusCode).to.equal(200);
        });
      });

      describe("GET /p2p/commission", function () {
        let response;

        before(async () => {
          response = await request(host)
            .get("/payments/p2p/commission")
            .set("Authorization", `Bearer ${token}`)
            .send();
        });

        it("should return 200 OK status code", function () {
          expect(response.statusCode).to.equal(200);
        });
      });

      describe("POST /p2p/confirm", function () {
        let response;

        before(async function () {
          const sessionGuid = await worker.getSessionValue("sessionGuid");

          const encryptData = await cryptoManager.encryptAndSign({
            password,
          });

          response = await request(host)
            .post("/payments/p2p/confirm")
            .set("Authorization", `Bearer ${token}`)
            .send({
              sign: encryptData.sign,
              cryptogram: encryptData.cryptogram,
              sessionGuid,
            });

          await worker.setSessionValue("cryptogram", response.body.cryptogram);
        });

        it("should return 200 OK status code", function () {
          expect(response.statusCode).to.equal(200);
        });

        it("should be ability to save card as template", function () {
          expect(response.body.hasCardToSave).to.equal(true);
          expect(response.body).to.has.property("cardToSave");
        });

        it("should have correct recipientContractId", function () {
          expect(response.body.recipientContractId).to.equal(
            recipientCard.contractId,
          );
        });

        it("should have property 'operation'", function () {
          expect(response.body).to.has.property("operation");
        });
      });
    });
  });

  describe("Переказ з картки на картку", function () {
    let stopRun;
    let token;
    let payerCard;
    let recipient;
    let amount;

    before(async () => {
      token = await worker.getSessionValue("token");

      const cardAccounts = await worker.getSessionValue("cardAccounts");
      const data = await worker.loadData();
      const payerCardName = data.payerCardName;

      payerCard = await worker.findCardByName(cardAccounts, payerCardName);
      recipient = env.vostokRecipientCardNumber;
      amount = await worker.randomAmount();
      stopRun = false;

      const balancesAtStart = await request(host)
        .get("/cards/v3/balances")
        .set("Authorization", `Bearer ${token}`)
        .send();

      if (!balancesAtStart || balancesAtStart.statusCode !== 200) {
        throw new Error("Не вдалось отримати баланси");
      } else {
        await worker.setSessionValue("balancesAtStart", balancesAtStart.body);
      }
    });

    before(function () {
      if (stopRun) {
        this.skip;
      }
    });

    describe("GET /p2p/markup", function () {
      let response;

      before(async () => {
        response = await request(host)
          .get("/payments/p2p/markup")
          .set("Authorization", `Bearer ${token}`)
          .send();

        if (!response || response.statusCode !== 200) {
          stopRun = true;
          throw new Error(
            `Status code: ${response.statusCode}, ${JSON.stringify(response?.body)}`,
          );
        } else {
          await worker.setMultipleSessionValues({
            cryptogram: response.body.cryptogram,
            sessionGuid: response.body.sessionGuid,
          });
        }
      });

      it("should return 200 OK status code", function () {
        expect(response.statusCode).to.equal(200);
      });
    });

    describe("GET /p2p/cardbin", function () {
      let response;

      before(async () => {
        const cardbin = recipient.slice(0, 8);
        response = await request(host)
          .get(`/payments/cardbin/${cardbin}/bank`)
          .set("Authorization", `Bearer ${token}`)
          .send();

        if (!response || response.statusCode !== 200) {
          stopRun = true;
          throw new Error(
            `Status code: ${response.statusCode}, ${JSON.stringify(response?.body)}`,
          );
        }
      });

      it("should return 200 OK status code", function () {
        expect(response.statusCode).to.equal(200);
      });
    });

    describe("POST /p2p/setInput", function () {
      let response;

      before(async function () {
        if (stopRun === true) {
          this.skip();
        }

        const sessionGuid = await worker.getSessionValue("sessionGuid");
        const encryptData = await cryptoManager.encryptAndSign({});
        const payerCardNumber = payerCard.cards[0].cardNumber;

        response = await request(host)
          .post("/payments/p2p/setInput")
          .set("Authorization", `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram,
            sessionGuid,
            payerId: `cardNumber:${payerCardNumber}`,
            recipientId: `cardNumber:${recipient}`,
            amount,
          });

        if (!response || response.statusCode !== 200) {
          stopRun = true;
          throw new Error(
            `Status code: ${response.statusCode}, ${JSON.stringify(response?.body)}`,
          );
        } else {
          await worker.setSessionValue("cryptogram", response.body.cryptogram);
        }
      });

      it("should return 200 OK status code", function () {
        expect(response.statusCode).to.equal(200);
      });
    });

    describe("GET /p2p/commission", function () {
      let response;

      before(async function () {
        if (stopRun === true) {
          this.skip();
        }

        response = await request(host)
          .get("/payments/p2p/commission")
          .set("Authorization", `Bearer ${token}`)
          .send();

        if (!response || response.statusCode !== 200) {
          stopRun = true;
          throw new Error(
            `Status code: ${response.statusCode}, ${JSON.stringify(response?.body)}`,
          );
        }
      });

      it("should return 200 OK status code", function () {
        expect(response.statusCode).to.equal(200);
      });
    });

    describe("POST /p2p/confirm", function () {
      let response;

      before(async function () {
        if (stopRun === true) {
          this.skip();
        }

        const sessionGuid = await worker.getSessionValue("sessionGuid");
        const encryptData = await cryptoManager.encryptAndSign({
          password,
        });

        response = await request(host)
          .post("/payments/p2p/confirm")
          .set("Authorization", `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram,
            sessionGuid: sessionGuid
          });

        if (!response || response.statusCode !== 200) {
          stopRun = true;
          throw new Error(
            `Status code: ${response.statusCode}, ${JSON.stringify(response?.body)}`,
          );
        } else {
          await worker.setMultipleSessionValues({
            cryptogram: response.body.cryptogram,
            operationId: response.body.operation.id,
          });
        }
      });

      it("should return 200 OK status code", function () {
        expect(response.statusCode).to.equal(200);
      });
    });

    describe.skip("POST /saveCard", function () {
      let response;

      before(async function () {
        if (stopRun === true) {
          this.skip();
        }

        const encryptData = await cryptoManager.encryptAndSign({
          password,
        });

        response = await request(host)
          .post("/payments/savedCards/saveFromLastPayment")
          .set("Authorization", `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram,
            cardName: "Дидик А.В. | Vostok (test)",
          });

        if (!response || response.statusCode !== 200) {
          stopRun = true;
          throw new Error(
            `Status code: ${response.statusCode}, ${JSON.stringify(response?.body)}`,
          );
        } else {
          await worker.setSessionValue("cryptogram", response.body.cryptogram);
        }
      });

      it("should return 200 OK status code", function () {
        expect(response.statusCode).to.equal(200);
      });
    });

    describe("GET /history/operations", function () {
      let response;
      let operationId;
      let currentOperation;

      before(async function() {
        if (stopRun === true) {
          this.skip();
        }

        await worker.waitForTime(15000);
        const contractId = payerCard.contractId;
        operationId = await worker.getSessionValue("operationId");

        response = await request(host)
          .get(`/history/operations?skip=0&take=30&contractId=${contractId}`)
          .set("Authorization", `Bearer ${token}`)
          .send();

        if (!response || response.statusCode !== 200) {
          stopRun = true;
          throw new Error(
            `Status code: ${response.statusCode}, ${JSON.stringify(response?.body)}`,
          );
        } else {
          await worker.setSessionValue("historyOperations", response.body);

          currentOperation = response.body.find(
            (item) => item.id === operationId,
          );

          if (!currentOperation) {
            throw new Error(
              `Не знайдено операцію з вказаним id: ${operationId}`,
            );
          }
        }
      });

      it("should return 200 OK status code", function () {
        expect(response.statusCode).to.equal(200);
      });

      it("should have status success", function () {
        expect(currentOperation.status).to.equal("success");
      });
    });

    describe("GET /balances", function () {
      let response;
      let payerBalanceAtStart;

      before(async function() {
        if (stopRun === true) {
          this.skip();
        }

        const balancesAtStart = await worker.getSessionValue("balancesAtStart");
        payerBalanceAtStart = balancesAtStart.agreementsBalances.find(
          (item) => item.contractId === payerCard.contractId,
        );

        response = await request(host)
          .get('/cards/v3/balances')
          .set("Authorization", `Bearer ${token}`)
          .send();

        if (!response || response.statusCode !== 200) {
          stopRun = true;
          throw new Error(
            `Status code: ${response.statusCode}, ${JSON.stringify(response?.body)}`,
          );
        }
      });

      it("should return 200 OK status code", function () {
        expect(response.statusCode).to.equal(200);
      });

      it("should update balances included lost operation", function () {
        const balances = response.body.agreementsBalances
        const payerBalanceAtEnd = balances.find(item => item.contractId === payerCard.contractId)
        const operationAmount = (Number(amount) * 100)

        expect(payerBalanceAtEnd.balance.totalAmount).to.equal(payerBalanceAtStart.balance.totalAmount - operationAmount)
      });

    });
  });
});

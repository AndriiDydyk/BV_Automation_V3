const request = require('supertest')
const { before } = require('mocha')
const Worker = require('../helper/worker')
const Ajv = require('ajv')
const { expect } = require('chai')

const ajv = new Ajv()
const worker = new Worker()

const baseUrl = 'https://bv.test.api.vostok.bank'

describe('Поповнення мобільного', function () {
  let token
  let password
  let payerCard
  let payerCardName
  let recipient
  let amount

  before(async () => {
    token = await worker.getSessionValue('token')
    const cardAccounts = await worker.getSessionValue('cardAccounts')
    const data = await worker.loadData()

    password = data.password
    payerCardName = data.payerCardName
    payerCard = await worker.findCardByName(cardAccounts, payerCardName)
    amount = await worker.randomAmount()
    recipient = data.recipientMobileMulti
  })

  describe('GET /mobilemulti/markup', function () {
    let response

    before(async () => {
      response = await request(baseUrl)
        .get('/payments/service/mobilemulti/markup')
        .set('Authorization', `Bearer ${token}`)
        .send()

      const cryptogram = response.body.cryptogram
      const sessionGuid = response.body.sessionGuid

      await worker.setSessionValue('cryptogram', cryptogram)
      await worker.setSessionValue('sessionGuid', sessionGuid)
    })

    it('should return 200 OK status code', function () {
      expect(response.statusCode).to.equal(200)
    })
  })

  describe('POST /mobilemulti/setInput', function () {
    let response

    before(async () => {
      const sessionGuid = await worker.getSessionValue('sessionGuid')

      const challange = await worker.decrypt_v2()
      const encryptData = await worker.encryptAndSign_v2({
        challengePass: challange,
        controls: [
          {
            Name: 'PayeeId',
            Value: `card:${payerCard.cards[0].id}`
          },
          {
            Name: 'PhoneNumber',
            Value: recipient
          },
          {
            Name: 'Amount',
            Value: amount
          }
        ]
      })
      response = await request(baseUrl)
        .post('/payments/v2/service/MobileMulti/setinput')
        .set('Authorization', `Bearer ${token}`)
        .send({
          cryptogram: encryptData.cryptogram,
          sign: encryptData.sign,
          sessionGuid
        })

      const cryptogram = response.body.cryptogram

      await worker.setSessionValue('cryptogram', cryptogram)
    })

    it('should return 200 OK status code', function () {
      expect(response.statusCode).to.equal(200)
    })
  })

  describe('GET /mobilemulti/commission', function () {
    let response

    before(async () => {
      response = await request(baseUrl)
        .get('/payments/v2/service/MobileMulti/commission')
        .set('Authorization', `Bearer ${token}`)
        .send()
    })

    it('should return 200 OK status code', function () {
      expect(response.statusCode).to.equal(200)
    })
  })

  describe('POST /mobilemulti/confirm', function () {
    let response

    before(async () => {
      const sessionGuid = await worker.getSessionValue('sessionGuid')

      const challange = await worker.decrypt_v2()
      const encryptData = await worker.encryptAndSign_v2({
        challengePass: challange,
        password
      })
      response = await request(baseUrl)
        .post('/payments/service/MobileMulti/confirm')
        .set('Authorization', `Bearer ${token}`)
        .send({
          cryptogram: encryptData.cryptogram,
          sign: encryptData.sign,
          sessionGuid
        })

      const cryptogram = response.body.cryptogram

      await worker.setSessionValue('cryptogram', cryptogram)
    })

    it('should return 200 OK status code', function () {
      expect(response.statusCode).to.equal(200)
    })
  })

  describe('POST saveAsTemplate', function () {
    let response

    before(async () => {
      const sessionGuid = await worker.getSessionValue('sessionGuid')
      const serviceName = 'MobileMulti'

      const challange = await worker.decrypt_v2()
      const encryptData = await worker.encryptAndSign_v2({
        challengePass: challange
      })
      response = await request(baseUrl)
        .post(`/payments/service/${serviceName}/saveAsTemplate`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          cryptogram: encryptData.cryptogram,
          sign: encryptData.sign,
          name: 'Поповнення мобільного'
        })

      const cryptogram = response.body.cryptogram

      await worker.setSessionValue('cryptogram', cryptogram)
    })

    it('should return 200 OK status code', function () {
      expect(response.statusCode).to.equal(200)
    })
  })
})

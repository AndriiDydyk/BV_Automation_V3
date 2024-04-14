/* eslint-disable require-jsdoc */

const { exec } = require('child_process')
const jsonfile = require('jsonfile')
const forge = require('node-forge')
const Redis = require('ioredis')
const opn = require('opn')

class Worker {
  async readJsonFile (filePath) {
    try {
      return await jsonfile.readFile(filePath)
    } catch (err) {
      console.error(`Помилка при читанні файлу ${filePath}:`, err)

      return {}
    }
  }

  async loadDevices () {
    const devices = await this.readJsonFile('./storage/devices.json')

    await this.setSessionValue('iosReleaseDevice', devices.iosReleaseDevice)
    await this.setSessionValue('iosDebugDevice', devices.iosDebugDevice)
  }

  async loadKeys () {
    const keys = await this.readJsonFile('./storage/keys.json')

    await this.setSessionValue('clientPublicKey', keys.clientPublicKey)
    await this.setSessionValue('clientPrivateKey', keys.clientPrivateKey)
  }

  async loadData () {
    const data = await this.readJsonFile('./storage/data.json')

    return data
  }

  async loadEnvironments () {
    const data = await this.readJsonFile('./storage/config.json')

    return data
  }

  async setSessionValue (key, value) {
    const redis = new Redis()
    try {
      await redis.set(key, JSON.stringify(value))
    } catch (error) {
      console.error(
        `Помилка при записі значення для ключа ${key} в Redis:`,
        error
      )
    } finally {
      redis.quit()
    }
  }

  async setMultipleSessionValues (data) {
    const redis = new Redis()
    try {
      const multi = redis.multi()
      for (const key in data) {
        if (data.hasOwnProperty(key)) {
          multi.set(key, JSON.stringify(data[key]))
        }
      }
      await multi.exec()
    } catch (error) {
      console.error('Помилка при записі значень у Redis:', error)
    } finally {
      redis.quit()
    }
  }

  async getSessionValue (key) {
    const redis = new Redis()
    try {
      const value = await redis.get(key)
      if (value) {
        const sessionData = JSON.parse(value)

        return sessionData
      }
      console.log(`Значення для ключа ${key} не знайдено в Redis`)
    } catch (error) {
      console.error(
        `Помилка при отриманні значення для ключа ${key} з Redis:`,
        error
      )
    } finally {
      redis.quit()
    }
  }

  async deleteValuesByKeys (keys) {
    const redis = new Redis()
    try {
      for (const key of keys) {
        await redis.del(key)
      }
    } catch (error) {
      console.error('Помилка при видаленні значень з Redis:', error)
    } finally {
      redis.quit()
    }
  }

  decrypt (cryptogram, privateKey) {
    const privateKeyObject = forge.pki.privateKeyFromPem(privateKey)
    const decrypted = forge.util.decode64(cryptogram)

    return privateKeyObject.decrypt(decrypted, 'RSA-OAEP')
  }

  async decrypt_v2 () {
    const cryptogram = await this.getSessionValue('cryptogram')
    const privateKey = await this.getSessionValue('clientPrivateKey')

    const privateKeyObject = forge.pki.privateKeyFromPem(privateKey)
    const decrypted = forge.util.decode64(cryptogram)

    return privateKeyObject.decrypt(decrypted, 'RSA-OAEP')
  }

  encryptAndSign (dataToEncrypt, serverPublicKey, clientPrivateKey) {
    const jsonToEncrypt = JSON.stringify(dataToEncrypt)
    const encryptedBytes = this.encrypt(jsonToEncrypt, serverPublicKey)
    const cryptogram = forge.util.encode64(encryptedBytes)
    const sign = this.signSha512(cryptogram, clientPrivateKey)

    return { sign, cryptogram }
  }

  async encryptAndSign_v2 (dataToEncrypt) {
    const serverPublicKey = await this.getSessionValue('serverPublicKey')
    const clientPrivateKey = await this.getSessionValue('clientPrivateKey')

    const jsonToEncrypt = JSON.stringify(dataToEncrypt)
    const encryptedBytes = this.encrypt(jsonToEncrypt, serverPublicKey)
    const cryptogram = forge.util.encode64(encryptedBytes)
    const sign = this.signSha512(cryptogram, clientPrivateKey)

    return { sign, cryptogram }
  }

  encrypt (message, serverPublicKey) {
    const publicKeyObject = forge.pki.publicKeyFromPem(serverPublicKey)
    const encrypted = publicKeyObject.encrypt(message, 'RSA-OAEP')

    return encrypted
  }

  signSha512 (message, clientPrivateKey) {
    const messageBytes = forge.util.decode64(message)
    const privateKeyObject = forge.pki.privateKeyFromPem(clientPrivateKey)

    const md = forge.md.sha512.create()

    md.update(messageBytes, 'raw')

    const pss = forge.pss.create({
      md: forge.md.sha512.create(),
      mgf: forge.mgf.mgf1.create(forge.md.sha512.create()),
      saltLength: 64
    })

    const signature = privateKeyObject.sign(md, pss)

    return forge.util.encode64(signature)
  }

  async findCardByName (cardsData, name) {
    try {
      const payerCard = cardsData.cardAccounts.find((item) =>
        item.cards.some((card) => card.cardName === name)
      )

      if (!payerCard) {
        throw new Error(`Card with name '${name}' not found`)
      }

      await this.setSessionValue('payerCard', payerCard)

      return payerCard
    } catch (error) {
      console.error('Error in findCardByName:', error.message)
      throw error
    }
  }

  async randomAmount () {
    const amount = (Math.random() * 0.99 + 1).toFixed(2).toString()

    return amount
  }

  async findOperation (historyOperation, id) {
    try {
      const operation = historyOperation.find((item) => item.id === id)

      if (!operation) {
        throw new Error('Операція з вказаним id не знайдена.')
      }

      return operation
    } catch (error) {
      console.error('Сталася помилка при пошуку операції:', error.message)
      return null
    }
  }

  async waitForTime (milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
  }

  async openInBrowser (url, browserName) {
    if (url !== '') {
      exec(
        `osascript -e 'tell application "${browserName}" to open location "${url}"'`,
        (err, stdout, stderr) => {
          if (err) {
            console.error(
              `Сталася помилка при відкриванні в ${browserName}:`,
              err
            )
            return
          }
          console.log(`Веб-сторінка успішно відкрита в ${browserName}`)

          // Додатковий код для фокусу на вікні браузера
          exec(`osascript -e 'tell application "${browserName}" to activate'`)
        }
      )
    } else {
      console.error('Вказана URL-адреса недійсна')
    }
  }
}

module.exports = Worker

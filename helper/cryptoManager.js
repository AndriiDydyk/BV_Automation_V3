const forge = require('node-forge')
const Redis = require('ioredis')

const Worker = require('./worker')

class CryptoManager extends Worker {
  constructor () {
    super()
  }

  async decrypt () {
    const cryptogram = await this.getSessionValue('cryptogram')
    const privateKey = await this.getSessionValue('clientPrivateKey')

    const privateKeyObject = forge.pki.privateKeyFromPem(privateKey)
    const decrypted = forge.util.decode64(cryptogram)

    return privateKeyObject.decrypt(decrypted, 'RSA-OAEP')
  }

  async encryptAndSign (dataToEncrypt) {
    const challange = await this.decrypt()
    dataToEncrypt.challengePass = challange

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
}

module.exports = CryptoManager

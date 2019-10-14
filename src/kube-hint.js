// @flow

// const jsonschema = require('jsonschema')

/* flow-include
type lintRules = {
  version: 'string'
}
*/

class KubeHintResults {
  errors /*: Array<Object> */ = [];

  warnings /*: Array<Object> */ = [];

  suggestions /*: Array<Object> */ = [];

  error = (
    docNumber /*: number */,
    key /*: string */,
    message /*: string */
  ) => {
    this.errors.push({ docNumber, key, message })
  };

  warn = (
    docNumber /*: number */,
    key /*: string */,
    message /*: string */
  ) => {
    this.warnings.push({ docNumber, key, message })
  };

  suggest = (
    docNumber /*: number */,
    key /*: string */,
    message /*: string */
  ) => {
    this.suggestions.push({ docNumber, key, message })
  };
}

class KubeHint {
  defaultLintRules = {
    version: '1.15.4'
  };

  constructor (lintRules /*: Object|void */) {
    if (lintRules) this.defaultLintRules = lintRules
  }

  lint (
    docs /*: Array<Object> */,
    rules /*: lintRules */ = this.defaultLintRules
  ) /*: KubeHintResults */ {
    if (!docs || !Array.isArray(docs)) {
      throw new Error(
        'Lint expects an array of document objects as its first argument'
      )
    }
    if (!rules || typeof rules !== 'object') {
      throw new Error('Lint expects a lintRules object as its second argument')
    }

    const results /*: KubeHintResults */ = new KubeHintResults()

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i]
      this.lintDocument(doc, i, results, rules)
    }

    return results
  }

  lintDocument (
    doc /*: Object */,
    docNumber /*: number */,
    results /*: KubeResults */ = new KubeHintResults(),
    rules /*: lintRules */ = this.defaultLintRules
  ) {
    const { error } = results

    // Basic structure sanity check
    if (!doc || typeof doc !== 'object') { error(null, 'Document is not an object!') } else if (!doc.apiVersion || typeof doc.apiVersion !== 'string') { error('apiVersion', 'apiVersion is invalid!') } else if (!doc.kind || typeof doc.kind !== 'string') { error('kind', 'kind is invalid!') }
    // Do not continue if any fatal errors above have occurred
    if (results.errors.length > 0) return results

    const kind = doc.kind.toLowerCase()
    const documentLinter = this.documentLinters[kind]

    if (documentLinter) {
      if (documentLinter[doc.apiVersion]) {
        documentLinter[doc.apiVersion](doc, docNumber, results)
      } else if (documentLinter.default) {
        documentLinter.default(doc, docNumber, results)
      }
    } else {
      process.stdout.write(
        `-> Warning! No linter defined for ${doc.apiVersion}/${doc.kind}\n`
      )
    }

    return results
  }

  documentLinters = {
    persistentvolumeclaim: {
      default: (
        doc /*: Object */,
        docNumber /*: number */,
        results /*: KubeHintResults */
      ) => {
        // const kind = doc.kind.toLowerCase()
        return results
      }
    },
    deployment: {
      'apps/v1': (
        doc /*: Object */,
        docNumber /*: number */,
        results /*: KubeHintResults */
      ) => {
        return this.documentLinters.deployment.default(doc, docNumber, results)
      },
      default: (
        doc /*: Object */,
        docNumber /*: number */,
        results /*: KubeHintResults */
      ) => {
        const { suggest, error, warn } = results
        const kind = doc.kind.toLowerCase()

        if (doc.spec.replicas < 2) {
          suggest(
            docNumber,
            'spec.replicas',
            'One replica implies a single point of failure!'
          )
        }
        if (doc.spec.template.spec.containers.length < 1) {
          error(
            docNumber,
            'spec.template.spec.containers.length',
            'No containers in this Deployment?'
          )
        }

        for (let i = 0; i < doc.spec.template.spec.containers.length; i++) {
          const container = doc.spec.template.spec.containers[i]
          if (!container.resources) {
            warn(
              docNumber,
              `spec.template.spec.containers[${i}]`,
              'No resource limits defined!'
            )
          }
        }

        // summarize(docNumber, {
        //   kind,
        //   name: doc.metadata.name,
        //   namespace: doc.metadata.namespace,
        //   message: `${doc.spec.replicas} ${
        //     doc.spec.replicas > 1 ? 'replicas' : 'replica'
        //   } of "${doc.spec.template.spec.containers
        //     .map(c => c.image)
        //     .join('", "')}"`
        // })

        return results
      }
    }
  };

  summarizeDocuments (docs /*: Array<Object> */) {
    // subjects: pods, replicasets, daemonsets, statefulsets, deployments, cronjobs, jobs
    const summaries = []
    docs.filter(d => {
      return [
        'pod', 'replicaset', 'daemonset', 'statefulset', 'deployment', 'cronjob', 'job'
      ].indexOf(d.kind.toLowerCase().replace(/s$/, '')) > -1
    }).map(doc => {
      const spec = doc.spec.template.spec
      const summary = []
      let subjectSummary = `A "${doc.metadata.name}" ${doc.kind}, with `
      const imagesSummary = []
      const servicesSummary = []

      // - Images
      // A "redis" Deployment, with 1 replica of “redis/redis”
      for (let i = 0; i < spec.containers.length; i++) {
        const container = spec.containers[i]
        imagesSummary.push(`${doc.spec.replicas} replica of "${container.image}"`)

        // - Services
        // exposed internally (not to the internet) at the DNS address “redis”
        if (container.ports) {
          // Find services that match this container/port
          docs.filter(d => d.kind.toLowerCase() === 'service')
        }
      }
      subjectSummary += imagesSummary.join(' and ')
      summary.push(subjectSummary)
      if (servicesSummary.length > 0) summary.push(servicesSummary)

      // - Volumes
      // with a 80gb volume "redis-pvc" mounted at /data
      if (spec.volumes) {
        const volumesSummary = []
        for (let i = 0; i < spec.volumes.length; i++) {
          if (spec.volumes[i].persistentVolumeClaim) {
            const pvc = docs.find(d => d.kind.toLowerCase() === 'persistentvolumeclaim' && d.metadata.name === spec.volumes[i].persistentVolumeClaim.claimName)
            spec.containers.map(c => c.volumeMounts && c.volumeMounts.map(v => {
              if (v.name === spec.volumes[i].name) {
                volumesSummary.push(`a ${pvc.spec.resources.requests.storage} volume "${pvc.metadata.name}" mounted at ${v.mountPath}`)
              }
            }))
          }
        }
        summary.push(`with ${volumesSummary.join(' and ')}`)
      }

      summaries.push(summary)
    })
    return summaries
  }
}

module.exports = {
  KubeHint,
  KubeHintResults
}

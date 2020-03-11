/**
 * Copyright 2020 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var log = require('./bunyan-api').createLogger('create-rd');
var argv = require('minimist')(process.argv.slice(2));

log.debug(`Running Install with args: ${JSON.stringify(argv)}`);

const { KubeClass, KubeApiConfig } = require('@razee/kubernetes-util');
const kubeApiConfig = KubeApiConfig();
const kc = new KubeClass(kubeApiConfig);

const objectPath = require('object-path');
const yaml = require('js-yaml');
const fs = require('fs-extra');
const axios = require('axios');
const handlebars = require('handlebars');

const argvNamespace = typeof (argv.n || argv.namespace) === 'string' ? argv.n || argv.namespace : 'razeedeploy';

async function main() {
  if (argv.h || argv.help) {
    log.info(`
-h, --help
    : help menu
-n, --namespace=''
    : namespace to populate razeedeploy resources into (Default 'razeedeploy')
--wk, --watch-keeper=''
    : install watch-keeper at a specific version (Default 'latest')
--cs, --clustersubscription=''
    : install clustersubscription at a specific version (Default 'latest')
--rd-url, --razeedash-url=''
    : url that watch-keeper should post data to
--rd-org-key, --razeedash-org-key=''
    : org key that watch-keeper will use to authenticate with razeedash-url
--rd-tags, --razeedash-tags=''
    : one or more comma-separated subscription tags which were defined in Razeedash
--rr, --remoteresource=''
    : install remoteresource at a specific version (Default 'latest')
--rrs3, --remoteresources3=''
    : install remoteresources3 at a specific version (Default 'latest')
--rrs3d, --remoteresources3decrypt=''
    : install remoteresources3decrypt at a specific version (Default 'latest')
--mtp, --mustachetemplate=''
    : install mustachetemplate at a specific version (Default 'latest')
--ffsld, --featureflagsetld=''
    : install featureflagsetld at a specific version (Default 'latest')
--ms, --managedset=''
    : install managedset at a specific version (Default 'latest')
-a, --autoupdate
    : will create a remoteresource that will pull and keep specified resources updated to latest (even if a version was specified). if no resources specified, will do all known resources.
    `);
    return;
  }

  let rdUrl = argv['rd-url'] || argv['razeedash-url'] || false;
  let rdOrgKey = argv['rd-org-key'] || argv['razeedash-org-key'] || false;
  let rdTags = argv['rd-tags'] || argv['razeedash-tags'] || '';

  let autoUpdate = argv.a || argv.autoupdate || false;
  let autoUpdateArray = [];

  let resourcesObj = {
    'watch-keeper': { install: argv.wk || argv['watch-keeper'], uri: 'https://github.com/razee-io/watch-keeper/releases/{{install_version}}/resource.yaml' },
    'clustersubscription': { install: argv.cs || argv['clustersubscription'], uri: 'https://github.com/razee-io/ClusterSubscription/releases/{{install_version}}/resource.yaml' },
    'remoteresource': { install: argv.rr || argv['remoteresource'], uri: 'https://github.com/razee-io/RemoteResource/releases/{{install_version}}/resource.yaml' },
    'remoteresources3': { install: argv.rrs3 || argv['remoteresources3'], uri: 'https://github.com/razee-io/RemoteResourceS3/releases/{{install_version}}/resource.yaml' },
    'remoteresources3decrypt': { install: argv.rrs3d || argv['remoteresources3decrypt'], uri: 'https://github.com/razee-io/RemoteResourceS3Decrypt/releases/{{install_version}}/resource.yaml' },
    'mustachetemplate': { install: argv.mtp || argv['mustachetemplate'], uri: 'https://github.com/razee-io/MustacheTemplate/releases/{{install_version}}/resource.yaml' },
    'featureflagsetld': { install: argv.ffsld || argv['featureflagsetld'], uri: 'https://github.com/razee-io/FeatureFlagSetLD/releases/{{install_version}}/resource.yaml' },
    'managedset': { install: argv.ms || argv['managedset'], uri: 'https://github.com/razee-io/ManagedSet/releases/{{install_version}}/resource.yaml' }
  };

  try {
    log.info('=========== Installing Prerequisites ===========');
    let preReqsJson = await readYaml('./src/resources/preReqs.yaml', { desired_namespace: argvNamespace });
    await decomposeFile(preReqsJson);

    let resourceUris = Object.values(resourcesObj);
    let resources = Object.keys(resourcesObj);
    let installAll = resourceUris.reduce((shouldInstallAll, currentValue) => {
      return objectPath.get(currentValue, 'install') === undefined ? shouldInstallAll : false;
    }, true);

    for (var i = 0; i < resourceUris.length; i++) {
      if (installAll || resourceUris[i].install) {
        log.info(`=========== Installing ${resources[i]}:${resourceUris[i].install || 'Install All Resources'} ===========`);
        if (resources[i] === 'watch-keeper') {
          if (rdUrl && rdOrgKey) {
            let wkConfigJson = await readYaml('./src/resources/wkConfig.yaml', { desired_namespace: argvNamespace, razeedash_url: rdUrl, razeedash_org_key: Buffer.from(rdOrgKey).toString('base64') });
            await decomposeFile(wkConfigJson, 'ensureExists');
          } else {
            log.warn('Failed to find args \'--razeedash-url\' and \'--razeedash-org-key\'.. will create template \'watch-keeper-config\' and \'watch-keeper-secret\' if they dont exist.');
            let wkConfigJson = await readYaml('./src/resources/wkConfig.yaml', { desired_namespace: argvNamespace, razeedash_url: 'insert-rd-url-here', razeedash_org_key: Buffer.from('api-key-youorgkeyhere').toString('base64') });
            await decomposeFile(wkConfigJson, 'ensureExists');
          }
        } else if (resources[i] === 'clustersubscription') {
          if (rdUrl && rdOrgKey) {
            let csConfigJson = await readYaml('./src/resources/csConfig.yaml', { desired_namespace: argvNamespace, razeedash_url: rdUrl, razeedash_org_key: Buffer.from(rdOrgKey).toString('base64'), razeedash_tags: rdTags });
            await decomposeFile(csConfigJson, 'ensureExists');
          } else {
            log.warn('Failed to find args \'--razeedash-url\' and \'--razeedash-org-key\'.. will create template \'clustersubscription\' ConfigMap and Secret if they dont exist.');
            let csConfigJson = await readYaml('./src/resources/csConfig.yaml', { desired_namespace: argvNamespace, razeedash_url: 'insert-rd-url-here', razeedash_org_key: Buffer.from('api-key-youorgkeyhere').toString('base64'), razeedash_tags: rdTags });
            await decomposeFile(csConfigJson, 'ensureExists');
          }
        }
        let { file } = await download(resourceUris[i]);
        file = yaml.safeLoadAll(file);
        await decomposeFile(file);
        if (autoUpdate) {
          autoUpdateArray.push({ options: { url: resourceUris[i].uri.replace('{{install_version}}', 'latest/download') } });
        }
      }
    }

    if (autoUpdate && (installAll || resourcesObj.remoteresource.install)) { // remoteresource must be installed to use autoUpdate
      log.info('=========== Installing Auto-Update RemoteResource ===========');
      let autoUpdateJson = await readYaml('./src/resources/autoUpdateRR.yaml', { desired_namespace: argvNamespace });
      objectPath.set(autoUpdateJson, '0.spec.requests', autoUpdateArray);
      try {
        await crdRegistered('deploy.razee.io/v1alpha2', 'RemoteResource');
        await decomposeFile(autoUpdateJson);
      } catch (e) {
        log.error(`${e}.. skipping autoUpdate`);
      }
    } else if (autoUpdate && !(installAll || resourcesObj.remoteresource.install)) {
      log.info('=========== Installing Auto-Update RemoteResource ===========');
      log.warn('RemoteResource CRD must be one of the installed resources in order to use RazeeDeploy Create Job. (eg. --rr).. Skipping autoUpdate');
    }
  } catch (e) {
    log.error(e);
  }
}

async function readYaml(path, templateOptions = {}) {
  let yamlFile = await fs.readFile(path, 'utf8');
  let yamlTemplate = handlebars.compile(yamlFile);
  let templatedJson = yaml.safeLoadAll(yamlTemplate(templateOptions));
  return templatedJson;
}

const pause = (duration) => new Promise(res => setTimeout(res, duration));

async function crdRegistered(apiVersion, kind, attempts = 5, backoffInterval = 50) {
  let krm = (await kc.getKubeResourceMeta(apiVersion, kind, 'get'));
  let krmExists = krm ? true : false;
  if (krmExists) {
    log.info(`Found ${apiVersion} ${kind}`);
    return krm;
  } else if (--attempts <= 0) {
    throw Error(`Failed to find ${apiVersion} ${kind}`);
  } else {
    log.warn(`Did not find ${apiVersion} ${kind}.. attempts remaining: ${attempts}`);
    await pause(backoffInterval);
    return crdRegistered(apiVersion, kind, attempts, backoffInterval * 2);
  }
}

async function download(resourceUriObj) {
  let install_version = (typeof resourceUriObj.install === 'string' && resourceUriObj.install.toLowerCase() !== 'latest') ? `download/${resourceUriObj.install}` : 'latest/download';
  let uri = resourceUriObj.uri.replace('{{install_version}}', install_version);
  try {
    log.info(`Downloading ${uri}`);
    return { file: (await axios.get(uri)).data, uri: uri };
  } catch (e) {
    let latestUri = resourceUriObj.uri.replace('{{install_version}}', 'latest/download');
    log.warn(`Failed to download ${uri}.. defaulting to ${latestUri}`);
    return { file: (await axios.get(latestUri)).data, uri: latestUri };
  }

}

async function decomposeFile(file, mode = 'replace') {
  let kind = objectPath.get(file, ['kind'], '');
  let apiVersion = objectPath.get(file, ['apiVersion'], '');
  let items = objectPath.get(file, ['items']);

  if (Array.isArray(file)) {
    for (let i = 0; i < file.length; i++) {
      await decomposeFile(file[i], mode);
    }
  } else if (kind.toLowerCase() == 'list' && Array.isArray(items)) {
    for (let i = 0; i < items.length; i++) {
      await decomposeFile(items[i], mode);
    }
  } else if (file) {
    let krm = await kc.getKubeResourceMeta(apiVersion, kind, 'update');
    if (krm) {
      if (!objectPath.has(file, 'metadata.namespace') && krm.namespaced) {
        log.info(`No namespace found for ${kind} ${objectPath.get(file, 'metadata.name')}.. setting namespace: ${argvNamespace}`);
        objectPath.set(file, 'metadata.namespace', argvNamespace);
      }
      try {
        if (mode === 'ensureExists') {
          await ensureExists(krm, file);
        } else {
          await replace(krm, file);
        }
      } catch (e) {
        log.error(e);
      }
    } else {
      log.error(`KubeResourceMeta not found: { kind: ${kind}, apiVersion: ${apiVersion}, name: ${objectPath.get(file, 'metadata.name')}, namespace: ${objectPath.get(file, 'metadata.namespace')} } ... skipping`);
    }
  }
}

async function replace(krm, file, options = {}) {
  let name = objectPath.get(file, 'metadata.name');
  let namespace = objectPath.get(file, 'metadata.namespace');
  let uri = krm.uri({ name: name, namespace: namespace, status: options.status });
  log.info(`Replace ${uri}`);
  let response = {};
  let opt = { simple: false, resolveWithFullResponse: true };
  let liveMetadata;
  log.info(`- Get ${uri}`);
  let get = await krm.get(name, namespace, opt);
  if (get.statusCode === 200) {
    liveMetadata = objectPath.get(get, 'body.metadata');
    log.info(`- Get ${get.statusCode} ${uri}: resourceVersion ${objectPath.get(get, 'body.metadata.resourceVersion')}`);
  } else if (get.statusCode === 404) {
    log.info(`- Get ${get.statusCode} ${uri}`);
  } else {
    log.info(`- Get ${get.statusCode} ${uri}`);
    return Promise.reject({ statusCode: get.statusCode, body: get.body });
  }

  if (liveMetadata) {
    objectPath.set(file, 'metadata.resourceVersion', objectPath.get(liveMetadata, 'resourceVersion'));

    log.info(`- Put ${uri}`);
    let put = await krm.put(file, opt);
    if (!(put.statusCode === 200 || put.statusCode === 201)) {
      log.info(`- Put ${put.statusCode} ${uri}`);
      return Promise.reject({ statusCode: put.statusCode, body: put.body });
    } else {
      log.info(`- Put ${put.statusCode} ${uri}`);
      response = { statusCode: put.statusCode, body: put.body };
    }
  } else {
    log.info(`- Post ${uri}`);
    let post = await krm.post(file, opt);
    if (!(post.statusCode === 200 || post.statusCode === 201 || post.statusCode === 202)) {
      log.info(`- Post ${post.statusCode} ${uri}`);
      return Promise.reject({ statusCode: post.statusCode, body: post.body });
    } else {
      log.info(`- Post ${post.statusCode} ${uri}`);
      response = { statusCode: post.statusCode, body: post.body };
    }
  }
  return response;
}

async function ensureExists(krm, file, options = {}) {
  let name = objectPath.get(file, 'metadata.name');
  let namespace = objectPath.get(file, 'metadata.namespace');
  let uri = krm.uri({ name: name, namespace: namespace, status: options.status });
  log.info(`EnsureExists ${uri}`);
  let response = {};
  let opt = { simple: false, resolveWithFullResponse: true };

  let get = await krm.get(name, namespace, opt);
  if (get.statusCode === 200) {
    log.info(`- Get ${get.statusCode} ${uri}`);
    return { statusCode: get.statusCode, body: get.body };
  } else if (get.statusCode === 404) { // not found -> must create
    log.info(`- Get ${get.statusCode} ${uri}`);
  } else {
    log.info(`- Get ${get.statusCode} ${uri}`);
    return Promise.reject({ statusCode: get.statusCode, body: get.body });
  }

  log.info(`- Post ${uri}`);
  let post = await krm.post(file, opt);
  if (post.statusCode === 200 || post.statusCode === 201 || post.statusCode === 202) {
    log.info(`- Post ${post.statusCode} ${uri}`);
    return { statusCode: post.statusCode, body: post.body };
  } else if (post.statusCode === 409) { // already exists
    log.info(`- Post ${post.statusCode} ${uri}`);
    response = { statusCode: 200, body: post.body };
  } else {
    log.info(`- Post ${post.statusCode} ${uri}`);
    return Promise.reject({ statusCode: post.statusCode, body: post.body });
  }
  return response;
}

main().catch(log.error);

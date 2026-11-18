'use strict';
const dataProfile = (() => {
  const dimensions = [
    ['Completeness','Are expected field values present?'],
    ['Validity','Do populated values conform to the expected type or format?'],
    ['Accuracy','Do values agree with an authoritative reference?'],
    ['Timeliness','Is the data current enough for its intended use?'],
    ['Consistency','Do related values agree with each other?'],
    ['Uniqueness','Does each record or key appear only once?']
  ];
  const blank = value => value == null || String(value).trim() === '';
  const fieldName = name => name.replace(/([a-z\d])([A-Z])/g,'$1_$2').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  const keyValue = value => String(value).trim();
  const numeric = value => !blank(value) && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(keyValue(value)) && Number.isFinite(Number(value));
  const count = value => /^\d+$/.test(keyValue(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  const email = value => /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(keyValue(value));
  const boolean = value => /^(?:true|false|yes|no|y|n|0|1)$/i.test(keyValue(value));
  const dayMillis = 86_400_000;
  const outcomeFields = [
    ['rule','Rule name',true,['rule_name','rule','dq_rule_name','dq_rule','check_name']],
    ['ruleKey','Rule key',false,['rule_key','rule_id','dq_rule_key','dq_rule_id','check_id']],
    ['population','Population',true,['population','population_count','total_count','total_records','record_count','total']],
    ['valid','Valid count',true,['valid_count','valid_record_count','valid_records','valid','valids','passed_count','passed']],
    ['invalid','Invalid count',true,['invalid_count','invalid_record_count','invalid_records','invalid','invalids','failed_count','failed']],
    ['score','Reported score',false,['dq_score','data_quality_score','quality_score','rule_score','reported_score','score']],
    ['group','Population name',false,['population_name','filter_group','filter_logic','filter','segment','scope','population_filter','group']],
    ['party','Population party type',false,['population_party_type','party_type']],
    ['date','Outcome date',false,['full_date','outcome_date','report_date','run_date','execution_date','result_date','snapshot_date','date']]
  ];

  function mapOutcomeFields(columns, saved = {}) {
    const keys = columns.map(fieldName);
    const used = new Set();
    const mapping = {};
    for (const [field,,required] of outcomeFields) {
      if (!required && saved[field] === null) {
        mapping[field] = -1;
        continue;
      }
      const index = columns.indexOf(saved[field]);
      if (index >= 0 && !used.has(index)) {
        mapping[field] = index;
        used.add(index);
      }
    }
    for (const [field,,,aliases] of outcomeFields) {
      if (field in mapping) continue;
      const index = aliases.map(alias=>keys.indexOf(alias)).find(index=>index>=0 && !used.has(index)) ?? -1;
      mapping[field] = index;
      if (index >= 0) used.add(index);
    }
    return mapping;
  }

  function validOutcomeMapping(mapping, derivePopulation = false) {
    if (outcomeFields.some(([field,,required])=>required && !(mapping[field]>=0) && !(field==='population' && derivePopulation))) return false;
    const mapped = Object.values(mapping).filter(index=>index>=0);
    return new Set(mapped).size === mapped.length;
  }

  function outcomeDate(value) {
    const text = keyValue(value ?? '');
    const dayFirst = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(text);
    const iso = dayFirst ? dayFirst[3]+'-'+dayFirst[2]+'-'+dayFirst[1] : text;
    return Number.isFinite(timestamp(iso)) ? iso.slice(0,10) : '';
  }

  function outcomeScore(value) {
    const text = keyValue(value ?? '').replace(/%$/,'').trim();
    return numeric(text) ? Number(text) : null;
  }

  function readOutcomes(rows, mapping, populationFields) {
    const results = [], excluded = new Set();
    for (const row of rows) {
      const rule = keyValue(row[mapping.rule] ?? '');
      const valid = count(row[mapping.valid]);
      const invalid = count(row[mapping.invalid]);
      const skipped = populationFields && !blank(row[populationFields.skippedIndex]) ? count(row[populationFields.skippedIndex]) : 0;
      const population = populationFields && skipped!==null ? valid+invalid+skipped : count(row[mapping.population]);
      if (!rule || !Number.isSafeInteger(population) || valid === null || invalid === null || valid > population - invalid) {
        excluded.add(row);
        continue;
      }
      results.push({
        row,rule,population,valid,invalid,
        ruleKey:keyValue(row[mapping.ruleKey] ?? ''),
        group:keyValue(row[mapping.group] ?? ''),
        party:keyValue(row[mapping.party] ?? ''),
        date:outcomeDate(row[mapping.date]),
        sourceDate:keyValue(row[mapping.date] ?? ''),
        score:blank(row[mapping.score]) ? '' : row[mapping.score],
        scoreValue:outcomeScore(row[mapping.score]),
        unclassified:population-valid-invalid,
        rate:valid+invalid ? valid/(valid+invalid) : null
      });
    }
    return {results,excluded};
  }

  const outcomeIdentity = outcome=>JSON.stringify(outcome.ruleKey?['key',outcome.ruleKey]:['name',outcome.rule]);

  function summarizeOutcomes(results, groupBy = 'population') {
    const rules = new Map(), groups = new Map();
    const recordResult = (collection,key,failed)=>collection.set(key,failed || collection.get(key)===true);
    const countFailures = collection=>[...collection.values()].filter(Boolean).length;
    for (const outcome of results) {
      const rule = outcomeIdentity(outcome);
      const population = groupBy==='population' && !outcome.group ? outcome.population : null;
      const label = {population:outcome.group,rule:outcome.rule,date:outcome.date,party:outcome.party}[groupBy];
      const party = groupBy==='population' ? outcome.party : '';
      const key = JSON.stringify(groupBy==='rule' ? [rule] : [label,party,population]);
      if (!groups.has(key)) groups.set(key,{label,party,population,ruleKey:groupBy==='rule'?outcome.ruleKey:'',
        rules:new Map(),outcomes:[],failedOutcomes:0,maxInvalid:0});
      const group = groups.get(key);
      const failed = outcome.invalid>0;
      recordResult(rules,rule,failed);
      recordResult(group.rules,rule,failed);
      group.outcomes.push(outcome);
      group.failedOutcomes += Number(failed);
      group.maxInvalid = Math.max(group.maxInvalid,outcome.invalid);
    }
    const populations = [...groups.values()].map(group=>({
      ...group,failed:countFailures(group.rules),rules:group.rules.size
    })).sort((a,b)=>(groupBy==='rule' ? b.maxInvalid-a.maxInvalid : b.failed-a.failed) ||
        b.maxInvalid-a.maxInvalid || a.label.localeCompare(b.label) || a.party.localeCompare(b.party) || a.population-b.population);
    return {rules:rules.size,failed:countFailures(rules),populations};
  }

  function timestamp(value) {
    const text = String(value ?? '').trim();
    const parts = /^(\d{4}-\d{2}-\d{2})(?:(?:T| )(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(text);
    if (!parts) return NaN;
    const day = Date.parse(parts[1]+'T00:00:00Z');
    if (!Number.isFinite(day) || new Date(day).toISOString().slice(0,10) !== parts[1]) return NaN;
    if (!parts[2]) return day;
    if (parts[2].startsWith('24:')) return NaN;
    return Date.parse(parts[1]+'T'+parts[2]+(parts[3]||'Z'));
  }

  function describeFields(columns,rows) {
    return columns.map((name,index)=>{
      const key = fieldName(name);
      const distinct = new Set();
      let populated = 0, numbers = 0, dates = 0, emails = 0, booleans = 0;
      let min = Infinity, max = -Infinity, earliest = Infinity, latest = -Infinity;
      for (const row of rows) {
        const value = row[index];
        if (blank(value)) continue;
        populated++;
        distinct.add(String(value));
        if (numeric(value)) {
          numbers++;
          min = Math.min(min,Number(value));
          max = Math.max(max,Number(value));
        }
        const time = timestamp(value);
        if (Number.isFinite(time)) {
          dates++;
          earliest = Math.min(earliest,time);
          latest = Math.max(latest,time);
        }
        if (email(value)) emails++;
        if (boolean(value)) booleans++;
      }
      const matches = count => populated > 0 && count/populated >= .8;
      let type = populated ? 'Text' : 'Unknown', validate = null;
      if (/(?:^|_)e_?mail(?:_address)?$/.test(key) || matches(emails)) {
        type = 'Email'; validate = email;
      } else if (matches(dates) || (dates && /(?:date|_at|timestamp)$/.test(key))) {
        type = 'Date/time'; validate = value=>Number.isFinite(timestamp(value));
      } else if ((/^(?:is|has|can)_/.test(key) || !matches(numbers)) && matches(booleans)) {
        type = 'Boolean'; validate = boolean;
      } else if (matches(numbers)) {
        type = 'Number'; validate = numeric;
      }
      const dateRange = dates ? [earliest,latest].map(time=>new Date(time).toISOString().slice(0,10)) : null;
      return {name,index,key,type,validate,populated,distinct:distinct.size,numericRange:numbers?[min,max]:null,dateRange};
    });
  }

  function rule(rows,name,criterion,test,origin='Inferred') {
    const outcome = {name,criterion,origin,unit:'records',passed:0,failed:0,skipped:0};
    for (const row of rows) {
      const result = test(row);
      outcome[result === true ? 'passed' : result === false ? 'failed' : 'skipped']++;
    }
    outcome.failure = row=>test(row) === false;
    outcome.notAssessed = row=>test(row) == null;
    return outcome;
  }

  function reportedFields(columns) {
    const keys = columns.map(fieldName);
    const find = names=>names.map(name=>keys.indexOf(name)).find(index=>index>=0) ?? -1;
    const dimensionIndex = find(['dimension','dq_dimension','quality_dimension','data_quality_dimension']);
    const ruleIndex = find(['rule','rule_name','check_name','rule_id','check_id','dq_rule']);
    const statusIndex = find(['status','outcome','result','rule_status','rule_result','check_status']);
    const passedIndex = find(['passed_count','pass_count','records_passed','passed']);
    const failedIndex = find(['failed_count','fail_count','records_failed','failed']);
    const skippedIndex = find(['skipped_count','not_assessed_count','not_assessed','skipped']);
    const countFormat = passedIndex>=0 && failedIndex>=0;
    if (dimensionIndex<0 || ruleIndex<0 || (!countFormat && statusIndex<0)) return null;
    return {dimensionIndex,ruleIndex,statusIndex,passedIndex,failedIndex,skippedIndex,countFormat};
  }

  function importedRules(columns,rows) {
    const fields = reportedFields(columns);
    if (!fields) return null;
    const {dimensionIndex,ruleIndex,statusIndex,passedIndex,failedIndex,skippedIndex,countFormat} = fields;
    const names = new Map(dimensions.map(([name])=>[name.toLowerCase(),name]));
    const groups = new Map();
    const unmapped = new Set(), unrecognized = new Set();
    for (const row of rows) {
      const dimension = names.get(keyValue(row[dimensionIndex]).toLowerCase());
      const name = keyValue(row[ruleIndex] ?? '');
      if (!dimension || !name) { unmapped.add(row); continue; }
      const key = JSON.stringify([dimension,name]);
      if (!groups.has(key)) groups.set(key,{
        dimension,name,origin:'Reported',unit:countFormat?'reported checks':'result rows',
        criterion:countFormat?'Passed and failed counts supplied by the source.':'Status supplied by the source.',
        passed:0,failed:0,skipped:0,excluded:0,failures:new Set(),unassessed:new Set()
      });
      const group = groups.get(key);
      if (countFormat) {
        const passed = count(row[passedIndex]), failed = count(row[failedIndex]);
        const skipped = skippedIndex<0 || blank(row[skippedIndex]) ? 0 : count(row[skippedIndex]);
        if (passed === null || failed === null || skipped === null ||
            !Number.isSafeInteger(group.passed+passed) || !Number.isSafeInteger(group.failed+failed) ||
            !Number.isSafeInteger(group.skipped+skipped)) {
          unrecognized.add(row);
          group.excluded++;
          continue;
        }
        group.passed += passed;
        group.failed += failed;
        group.skipped += skipped;
        if (failed) group.failures.add(row);
        if (skipped) group.unassessed.add(row);
        continue;
      }
      const value = fieldName(keyValue(row[statusIndex]));
      if (['pass','passed','success','successful','ok','true','valid'].includes(value)) group.passed++;
      else if (['fail','failed','failure','false','invalid','violation','error'].includes(value)) {
        group.failed++;
        group.failures.add(row);
      } else {
        group.skipped++;
        group.unassessed.add(row);
        if (!['skipped','not_assessed','not_evaluated','not_applicable','unknown','pending'].includes(value)) unrecognized.add(row);
      }
    }
    return {
      unmapped,unrecognized,
      rules:[...groups.values()].map(({failures,unassessed,...group})=>({
        ...group,failure:row=>failures.has(row),notAssessed:row=>unassessed.has(row)
      }))
    };
  }

  function evaluateReported(columns,rows) {
    const byDimension = Object.fromEntries(dimensions.map(([name])=>[name,[]]));
    const reported = importedRules(columns,rows);
    for (const {dimension,...outcome} of reported.rules) byDimension[dimension].push(outcome);
    return {fields:[],byDimension,reported};
  }

  function evaluate(columns,rows,settings) {
    const fields = describeFields(columns,rows);
    const byDimension = Object.fromEntries(dimensions.map(([name])=>[name,[]]));

    for (const field of fields) {
      byDimension.Completeness.push(rule(rows,field.name+' is populated','Whitespace-only values count as missing. Treat this as required only if your policy says so.',row=>!blank(row[field.index])));
      if (field.validate) {
        byDimension.Validity.push(rule(rows,field.name+' conforms to '+field.type.toLowerCase(),'Format inferred from the field name or at least 80% of populated values. Blank values are not assessed.',
          row=>blank(row[field.index]) ? null : field.validate(row[field.index])));
      }
    }

    const rowKey = row=>JSON.stringify(row.map(value=>value==null?null:String(value)));
    const seen = new Set(), duplicateRows = new Set();
    for (const row of rows) {
      const key = rowKey(row);
      if (seen.has(key)) duplicateRows.add(row);
      else seen.add(key);
    }
    byDimension.Uniqueness.push(rule(rows,'No exact duplicate records','Counts each identical copy after its first occurrence.',row=>!duplicateRows.has(row)));

    const inferredKey = fields.find(field=>/^(?:id|record_id|row_id|primary_key|uuid)$/.test(field.key)) ??
      fields.find(field=>/(?:_id|_key|_uuid)$/.test(field.key) && field.populated>=2 && field.distinct/field.populated>=.8);
    const selectedKey = settings.key === undefined ? inferredKey : fields[settings.key];
    if (selectedKey) {
      const counts = new Map();
      for (const row of rows) {
        const value = row[selectedKey.index];
        if (!blank(value)) counts.set(keyValue(value),(counts.get(keyValue(value))||0)+1);
      }
      byDimension.Uniqueness.push(rule(rows,selectedKey.name+' is unique',
        'Flags every record sharing a nonblank key. Whitespace around keys is ignored.',
        row=>blank(row[selectedKey.index]) ? null : counts.get(keyValue(row[selectedKey.index])) === 1,
        settings.key===undefined ? 'Inferred' : 'Configured'));
    }

    const dateFields = fields.filter(field=>field.dateRange);
    const datedKeys = new Map(dateFields.map(field=>[field.key,field]));
    const pairs = new Set();
    for (const first of dateFields) {
      const secondName = first.key.replace(/(^|_)(start|created|opened)(?=_|$)/,(_,prefix,word)=>
        prefix+({start:'end',created:'updated',opened:'closed'}[word]));
      const second = datedKeys.get(secondName);
      if (!second || second===first || pairs.has(secondName)) continue;
      pairs.add(secondName);
      byDimension.Consistency.push(rule(rows,second.name+' is on or after '+first.name,
        'Date order inferred from paired field names. Missing or invalid dates are not assessed.',row=>{
          const start = timestamp(row[first.index]), end = timestamp(row[second.index]);
          return Number.isFinite(start) && Number.isFinite(end) ? start<=end : null;
        }));
    }
    for (const field of fields.filter(item=>item.type==='Text' && item.distinct>=2 && item.distinct<=30 && item.distinct<item.populated)) {
      const canonical = value=>keyValue(value).toLowerCase();
      const forms = new Map(), mixed = new Set();
      for (const row of rows) {
        const value = row[field.index];
        if (blank(value)) continue;
        const key = canonical(value);
        if (forms.has(key) && forms.get(key)!==String(value)) mixed.add(key);
        else forms.set(key,String(value));
      }
      byDimension.Consistency.push(rule(rows,field.name+' uses consistent category spelling',
        'Flags groups with multiple case or outer whitespace variants. Review whether the variants represent the same category.',
        row=>blank(row[field.index]) ? null : !mixed.has(canonical(row[field.index]))));
    }

    if (settings.freshness) {
      const {field,days,asOf} = settings.freshness;
      const end = timestamp(asOf);
      byDimension.Timeliness.push(rule(rows,fields[field].name+' is within '+days+' days',
        'UTC calendar days through '+asOf+' inclusive. Future dates fail. Missing or invalid dates are not assessed.',row=>{
          const time = timestamp(row[field]);
          if (!Number.isFinite(time)) return null;
          const age = (end-Math.floor(time/dayMillis)*dayMillis)/dayMillis;
          return age>=0 && age<=days;
        },'Configured'));
    }

    if (settings.accuracy) {
      const {reference,sourceKey,referenceKey,sourceField,referenceField} = settings.accuracy;
      const referenceByKey = new Map(), ambiguous = new Set();
      for (const row of reference.rows) {
        if (blank(row[referenceKey])) continue;
        const key = keyValue(row[referenceKey]);
        if (referenceByKey.has(key)) ambiguous.add(key);
        else referenceByKey.set(key,row[referenceField]);
      }
      byDimension.Accuracy.push(rule(rows,fields[sourceField].name+' agrees with the reference',
        'Exact value match against '+reference.name+' / '+reference.columns[referenceField]+
        ' joined on '+fields[sourceKey].name+'. Missing values and unmatched or ambiguous keys are not assessed.',row=>{
          if (blank(row[sourceKey]) || blank(row[sourceField])) return null;
          const key = keyValue(row[sourceKey]);
          const expected = referenceByKey.get(key);
          return ambiguous.has(key) || blank(expected) ? null : String(row[sourceField]) === String(expected);
        },'Configured'));
    }

    return {fields,byDimension,reported:null,inferredKey:inferredKey?.index ?? -1};
  }

  return {dimensions,evaluate,evaluateReported,fieldName,timestamp,outcomeFields,mapOutcomeFields,validOutcomeMapping,readOutcomes,summarizeOutcomes,
    outcomeIdentity,outcomeDate,reportedFields};
})();

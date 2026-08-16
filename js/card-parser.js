/* ============================================================
   card-parser.js — turns raw OCR output into structured contact
   fields. Score-based classification using layout (font size,
   position, adjacency), dictionaries (titles, first names,
   surnames, legal suffixes, Indian states/cities), and OCR-noise
   repair for emails, URLs, phones and GSTIN.
   Exposes global: CardParser
   ============================================================ */
(function () {
  'use strict';

  /* ================= categories (shared with the review UI) ================= */

  const CATEGORIES = [
    ['name', 'Name'],
    ['title', 'Job title'],
    ['department', 'Department'],
    ['company', 'Company'],
    ['mobile', 'Mobile phone'],
    ['work-phone', 'Work phone'],
    ['home-phone', 'Home phone'],
    ['fax', 'Fax'],
    ['email', 'Email'],
    ['website', 'Website'],
    ['social', 'Social link'],
    ['address', 'Address'],
    ['address2', 'Address (2nd)'],
    ['custom', 'Custom (Key: value)'],
    ['notes', 'Note'],
    ['ignore', '— Ignore —']
  ];

  /* ================= dictionaries ================= */

  const words = s => new Set(s.toLowerCase().split(/\s+/).filter(Boolean));

  const FIRST_NAMES = words(`
    aarav aditya ajay akash akhil amar amit anand anil ankit anuj anurag arjun arun arvind ashish ashok atul bharat bhaskar
    chandan chetan deepak dev dinesh gaurav girish gopal harish hemant jatin jay jitendra kamal karan kartik kiran kishore
    krishna kunal lalit mahesh manish manoj mohan mohit mukesh naveen neeraj nikhil nitin pankaj parag pawan prakash pramod
    prashant praveen rahul raj rajat rajeev rajesh rajiv rakesh ram ramesh ravi rohan rohit sachin sagar sameer samir sandeep
    sanjay sanjeev santosh satish saurabh shailesh shashank shiv shyam siddharth sumit sunil suresh tarun umesh varun vijay
    vikas vikram vinay vinod vishal vivek yash yogesh abhishek ashutosh devendra dhruv harsh ishaan kabir madhav naman parth
    pranav rishabh ritesh ronak shubham tanmay utkarsh vedant aakash ajit alok anant anup ashwin balaji chirag darshan ganesh
    hari jagdish jayesh kalpesh kaushik ketan mayank mihir nilesh nirav paresh pratik rajendra ravindra rupesh sanjiv shreyas
    subhash sudhir surendra tushar vipul vishnu naresh mahendra jitender narendra virender surender rajender dharmendra
    aarti aditi aishwarya amrita ananya anita anjali anju ankita anushka archana asha bhavna deepa deepika divya ekta garima
    geeta isha jaya jyoti kajal kavita kavya komal kriti lakshmi lata madhu manisha meena meera megha mona monika namrata
    nandini neha nidhi nikita nisha nithya pallavi payal pooja prachi pratibha preeti priya priyanka rachna radha rani rashmi
    rekha renu richa ritu riya ruchi sakshi sangeeta sarika seema shalini shikha shilpa shreya shweta simran smita sneha sonal
    sonia sujata suman sunita supriya swati tanvi tanya uma usha vandana varsha vidya sarita radhika sushma kalpana kanchan
    alka anamika chitra hema indu kirti malini mamta nirmala padma poonam pushpa rajni rupa sadhana savita sheetal shobha
    sudha sunanda
    john james robert michael william david richard joseph thomas charles daniel matthew anthony mark paul steven andrew
    kevin brian george edward ronald timothy jason jeffrey ryan jacob gary nicholas eric jonathan stephen larry justin scott
    brandon benjamin samuel frank gregory raymond alexander patrick jack dennis jerry tyler aaron jose henry adam douglas
    nathan peter zachary kyle noah ethan liam oliver lucas mason logan alex chris tom mike dan sam ben max leo
    mary patricia jennifer linda elizabeth barbara susan jessica sarah karen nancy lisa betty margaret sandra ashley
    kimberly emily donna michelle carol amanda melissa deborah stephanie rebecca laura sharon cynthia kathleen amy shirley
    angela helen anna brenda pamela nicole emma samantha katherine christine debra rachel catherine carolyn janet ruth
    maria heather diane julie joyce victoria kelly christina lauren joan evelyn olivia judith megan cheryl andrea hannah
    jacqueline martha gloria teresa ann sara madison frances kathryn janice jean abigail alice judy sophia grace denise
    amber danielle isabella theresa diana natalie brittany charlotte marie kayla alexis lori claire zoe chloe kate lucy
    dean mason taylor hunter parker carter tyler jordan blake logan austin
    ahmed mohammed muhammad mohammad ali omar hassan hussain hussein khalid fatima aisha layla zainab yusuf ibrahim ismail
    imran faisal salman tariq rashid nadia hina sana asif arif irfan javed nadeem naseem shahid zubair
    wei li ming chen yuki hiroshi kenji carlos juan luis miguel diego sofia ana lucia hans klaus stefan andreas marc
    pierre luc nicolas julien giovanni marco luca ivan sergei olga elena
  `);

  const SURNAMES = words(`
    sharma gupta verma singh kumar patel shah mehta jain agarwal agrawal aggarwal bansal goel goyal mittal garg singhal
    jindal khanna kapoor malhotra chopra arora bhatia sethi anand chadha sahni kohli gill dhillon sandhu sidhu grewal bajaj
    bhalla tandon saxena srivastava shrivastava mishra tiwari tripathi pandey dubey shukla chaturvedi yadav chauhan rathore
    rajput thakur solanki chavan patil deshmukh kulkarni joshi desai modi trivedi pandya bhatt dave vyas nair menon pillai
    iyer iyengar krishnan raman rao reddy naidu murthy murty prasad sastry chowdhury chaudhary chaudhuri choudhury choudhary
    banerjee bhattacharya bhattacharjee chatterjee mukherjee ganguly das dutta ghosh bose sen roy sarkar saha mondal mandal
    majumdar nath debnath paul khan ahmed ansari siddiqui qureshi sheikh shaikh syed hussain mirza baig pathan fernandes
    dsouza d'souza pinto lobo rodrigues gomes mathew thomas george varghese kurian jacob philip john cherian abraham sood
    sachdeva chawla kalra nagpal wadhwa bhargava saini rana negi rawat bisht bhandari sisodia shekhawat meena bhat kaul dhar
    raina pandit kaur bedi suri talwar vohra kakkar ahuja ahluwalia dhawan duggal khurana lamba luthra madan mahajan marwah
    oberoi sabharwal sarin seth sikka uppal walia kamath shenoy shetty hegde pai nayak naik sawant gaikwad jadhav pawar
    shinde more kadam bhosale thakkar panchal parekh parikh doshi kothari sanghvi lodha bhansali vora vaidya nanda barua
    gogoi bora hazarika deka kalita saikia chowdary varma raju goud kannan subramanian ramaswamy venkatesh srinivasan
    natarajan sundaram rajan sekar selvam murugan pandian sinha jha mahto ojha kashyap rastogi khare nigam bhatnagar mathur
    tyagi dixit awasthi pathak upadhyay bajpai sahu sahoo mohanty patnaik behera rout panda swain jena pradhan parida dash
    agarwala kedia poddar khaitan lohia bagaria maheshwari somani biyani ruia dalmia birla ambani adani hinduja tata
    smith johnson williams brown jones garcia miller davis rodriguez martinez hernandez lopez gonzalez wilson anderson
    taylor moore jackson martin lee perez thompson white harris sanchez clark ramirez lewis robinson walker young allen
    king wright scott torres nguyen hill flores green adams nelson baker hall rivera campbell mitchell carter roberts
    gomez phillips evans turner diaz parker cruz edwards collins reyes stewart morris morales murphy cook rogers ortiz
    morgan cooper peterson bailey reed kelly howard ramos kim cox ward richardson watson brooks wood james bennett gray
    hughes price sanders myers long ross foster powell jenkins perry russell sullivan bell coleman butler henderson barnes
    fisher simmons jordan patterson alexander hamilton graham reynolds griffin wallace west cole hayes bryant gibson ellis
    tran stevens murray ford marshall owens harrison woods kennedy wells henry chen freeman webb tucker burns crawford
    olson simpson porter hunter gordon silva shaw snyder dixon hunt holmes palmer wagner black robertson boyd rose stone
    fox warren mills meyer rice schmidt fischer weber becker hoffmann koch schneider mueller muller wolf schulz krause
    dupont durand leroy moreau laurent lefebvre bernard martin rossi russo ferrari esposito bianchi romano colombo ricci
    wong wang li zhang liu yang huang zhao wu zhou tanaka suzuki sato watanabe ito yamamoto nakamura kobayashi park choi
  `);

  const NAME_PREFIX = /^(?:mr|mrs|ms|miss|mx|dr|prof|professor|doctor|er|ar|adv|advocate|ca|cs|cma|capt|captain|col|colonel|maj|lt|lieutenant|gen|brig|brigadier|cdr|commander|wg\s*cdr|sqn\s*ldr|sri|shri|sree|shree|smt|kum|km|md|mohd|syed|sh|prop|proprietor|pandit|pt|swami|justice|hon'?ble|late|rev|reverend|fr|sister|sheikh|haji|hajji|maulana|imam|ustad|acharya|vaidya|dipl\.?-?ing|dr\.?-?ing|ing|mag|dott|dott\.?ssa|sr|sra|mme|mlle|herr|frau|hr)\b\.?\s*(?:\((?:mrs|ms|miss|smt|dr)\.?\)\s*)?:?\s*/i;
  const NAME_PREFIX_ABBR = /^(mr|mrs|ms|mx|dr|prof|er|ar|adv|ca|cs|cma|capt|col|maj|lt|gen|brig|cdr|smt|kum|km|md|mohd|sh|prop|pt|rev|fr|sr|sra|mme|mlle|hr|ing|mag|dott)$/i;
  const NAME_PREFIX_ONLY = /^(?:mr|mrs|ms|miss|dr|prof|er|ar|adv|ca|cs|capt|col|maj|lt|sri|shri|smt|kum|md|mohd|syed|sh)\b\.?$/i;

  const TITLE_WORDS = [
    'ceo', 'cto', 'cfo', 'coo', 'cmo', 'cio', 'cso', 'chairman', 'chairperson', 'chairwoman', 'founder', 'co-founder', 'cofounder',
    'director', 'managing director', 'president', 'vice president', 'vp', 'avp', 'evp', 'svp', 'proprietor', 'proprietress', 'partner',
    'manager', 'general manager', 'gm', 'dgm', 'agm', 'head', 'lead', 'chief', 'officer', 'executive', 'supervisor', 'associate',
    'senior', 'junior', 'assistant', 'asst', 'deputy', 'dy', 'principal', 'engineer', 'developer', 'programmer', 'architect',
    'designer', 'consultant', 'advisor', 'adviser', 'analyst', 'specialist', 'coordinator', 'administrator', 'accountant', 'auditor',
    'advocate', 'attorney', 'lawyer', 'counsel', 'solicitor', 'barrister', 'notary', 'doctor', 'physician', 'surgeon', 'dentist',
    'orthodontist', 'pharmacist', 'physiotherapist', 'dietitian', 'nutritionist', 'psychologist', 'psychiatrist', 'paediatrician',
    'pediatrician', 'cardiologist', 'neurologist', 'dermatologist', 'gynaecologist', 'gynecologist', 'obstetrician', 'radiologist',
    'oncologist', 'orthopaedic', 'orthopedic', 'ophthalmologist', 'ent', 'anaesthetist', 'homoeopath', 'homeopath', 'ayurvedic',
    'veterinarian', 'vet', 'professor', 'lecturer', 'teacher', 'tutor', 'trainer', 'coach', 'instructor', 'dean', 'registrar',
    'sales', 'marketing', 'business development', 'operations', 'hr', 'human resources', 'finance', 'accounts', 'purchase',
    'procurement', 'supply chain', 'logistics', 'production', 'quality', 'maintenance', 'r&d', 'research', 'technical', 'technician',
    'service', 'support', 'admin', 'legal', 'compliance', 'audit', 'tax', 'company secretary', 'secretary', 'treasurer',
    'photographer', 'journalist', 'editor', 'writer', 'author', 'realtor', 'broker', 'agent', 'dealer', 'distributor',
    'stockist', 'contractor', 'builder', 'developer', 'planner', 'strategist', 'scientist', 'researcher', 'therapist',
    'stylist', 'chef', 'owner', 'co-owner', 'incharge', 'in-charge', 'in charge', 'regional', 'zonal', 'area', 'branch',
    'territory', 'national', 'country', 'product', 'project', 'program', 'programme', 'account', 'relationship', 'customer',
    'client', 'plant', 'works', 'freelance', 'freelancer', 'independent', 'practitioner', 'surveyor', 'valuer', 'pilot',
    'captain', 'commissioner', 'inspector', 'superintendent', 'clerk', 'foreman', 'operator', 'electrician', 'plumber',
    'mechanic', 'carpenter', 'welder', 'tailor', 'beautician', 'makeup artist', 'artist', 'musician', 'actor', 'model',
    'influencer', 'blogger', 'youtuber', 'content creator', 'social media', 'digital marketing', 'seo', 'graphic', 'ui', 'ux',
    'web', 'software', 'data', 'cloud', 'devops', 'qa', 'tester', 'network', 'security', 'sap', 'erp', 'md', 'trustee', 'member',
    'director general', 'general secretary', 'president', 'convenor', 'convener', 'councillor', 'councilor', 'mla', 'mp',
    'jeweller', 'jeweler', 'goldsmith', 'pharmacist', 'chemist', 'druggist', 'optician', 'astrologer', 'pandit', 'priest',
    'interior', 'landscape', 'civil', 'mechanical', 'electrical', 'structural', 'chartered', 'cost', 'insurance', 'investment',
    'wealth', 'financial', 'mutual fund', 'loan', 'property', 'real estate', 'travel', 'tour', 'event', 'wedding'
  ];
  const TITLE_RE = new RegExp('\\b(' + TITLE_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|') + ')\\b', 'i');
  // strong: words that are almost exclusively designations (never brand words)
  const TITLE_STRONG = /\b(ceo|cto|cfo|coo|cmo|cio|founder|co-?founder|director|managing director|president|vice president|vp|avp|proprietor|proprietress|manager|head of|chief|officer|executive|engineer|developer|consultant|advisor|adviser|analyst|specialist|coordinator|administrator|accountant|auditor|advocate|attorney|lawyer|physician|surgeon|dentist|professor|lecturer|teacher|principal|secretary|treasurer|chairman|chairperson|partner|owner|incharge|in-charge|associate|assistant|deputy|supervisor|technician|paediatrician|pediatrician|cardiologist|neurologist|dermatologist|gynaecologist|gynecologist|radiologist|oncologist|ophthalmologist|therapist|trainer|coach|instructor|architect|designer|realtor|broker|agent|photographer|journalist|editor|writer|freelance|freelancer|practitioner|pilot|captain|inspector|superintendent|registrar|trustee|convenor|convener)\b/i;

  const DEGREES = /\b(m\.?b\.?b\.?s|m\.?d|m\.?s|m\.?d\.?s|b\.?d\.?s|b\.?a\.?m\.?s|b\.?h\.?m\.?s|d\.?n\.?b|d\.?m|m\.?ch|f\.?r\.?c\.?s|m\.?r\.?c\.?p|ph\.?\s?d|m\.?b\.?a|b\.?tech|m\.?tech|b\.?e|m\.?e|b\.?sc|m\.?sc|b\.?com|m\.?com|b\.?a|m\.?a|ll\.?b|ll\.?m|f\.?c\.?a|a\.?c\.?a|a\.?c\.?s|f\.?c\.?s|c\.?m\.?a|i\.?c\.?w\.?a|c\.?f\.?a|c\.?p\.?a|b\.?arch|m\.?arch|b\.?pharm|m\.?pharm|d\.?pharm|b\.?p\.?t|m\.?p\.?t|d\.?c\.?h|d\.?g\.?o|d\.?o\.?m\.?s|f\.?i\.?e|m\.?i\.?e|p\.?g\.?d\.?m|p\.?g\.?d\.?b\.?a|b\.?c\.?a|m\.?c\.?a|dip(?:loma)?|hons|gold medalist|fellow|d\.?ortho|m\.?s\s*\(ortho\)|b\.?ed|m\.?ed|m\.?phil|d\.?lit|pgdca|b\.?v\.?sc|m\.?v\.?sc|b\.?h\.?m|m\.?h\.?m|c\.?a|c\.?s)\b/i;
  const MEDICAL_DEGREE = /\b(mbbs|bds|bams|bhms|dnb|dm|mch|frcs|mrcp|mds|dch|dgo|doms|d\.?ortho|m\.?s\s*\((?:ortho|ent|gen|surg)|md\s*\(|bpt|mpt|b\.?pharm|m\.?pharm)\b/i;

  const COMPANY_STRONG = /\b(pvt\.?\s*ltd\.?|private\s+limited|p\.?\s*ltd\.?|ltd\.?|limited|llp|llc|inc\.?|incorporated|corp\.?|corporation|gmbh|ag|s\.?a\.?r\.?l\.?|s\.?a\.?|plc|pte|bhd|sdn|opc|&\s*(sons?|co\.?|bros\.?|brothers|associates?|company)|and\s+(sons?|co\.?|bros\.?|brothers|associates?|company)|group\s+of\s+companies|a\s+unit\s+of|a\s+division\s+of|an?\s+iso\s+\d)\b/i;
  const COMPANY_WEAK = /\b(company|co|enterprises?|industries|industry|traders?|trading|exports?|imports?|impex|group|holdings?|ventures?|solutions?|technologies|technology|tech|systems?|infotech|software|softwares|studios?|labs?|laboratories|agency|agencies|associates?|consultants?|consultancy|services?|logistics|textiles?|jewell?ers?|jewels?|caterers?|builders?|developers?|infra(?:structure)?|constructions?|contractors?|projects|realty|realtors|properties|estates?|motors?|automobiles?|autos?|electricals?|electronics|electric|engineering|engineers|works|foods?|farms?|agro|organics?|pharma(?:ceuticals?)?|pharmacy|hospitals?|clinics?|clinic|nursing home|diagnostics?|academy|institute|institution|school|college|university|foundation|trust|society|store|stores|mart|bazaa?r|emporium|collections?|creations?|fashions?|garments?|apparels?|designs?|prints?|printers|packaging|packers|international|overseas|global|india|hindustan|national|corporation|centre|center|point|house|hub|zone|world|planet|hardware|sanitary|paints|steel|steels|metals?|plastics?|polymers?|chemicals?|cements?|tiles?|marbles?|granites?|glass|timber|furniture|interiors|decor|décor|events?|travels?|tours?|holidays?|cargo|movers|transport|carriers|couriers?|finance|financials?|capital|securities|insurance|investments?|advisors|advisory|wealth|media|entertainment|films?|productions?|studios|digital|creative|innovations?|network|networks|telecom|communications?|mobiles?|computers?|infosys|infosystems|solution|hospitality|hotels?|restaurants?|cafe|café|bakery|sweets|dairy|foods|beverages|water|energy|power|solar|renewables?|oil|gas|mining|minerals|textile|mills?|spinning|weaving|dyeing|processing|manufacturing|manufacturers|fabricators?|fabrication|machinery|machines|tools|equipments?|instruments|controls|automation|robotics|aerospace|defence|marine|shipping|ports?|aviation|airlines|motors|cycles|tyres|batteries|lighting|lights|appliances|kitchens?|bath|ceramics|handicrafts?|handlooms?|silk|cotton|leather|footwear|shoes|bags|toys|gifts|stationery|books|publishers|publishing|education|coaching|classes|academy|training|placements?|hr|staffing|manpower|security|guards|facility|cleaning|pest|garden|nursery|florists?|pets?|vet|dental|eye|skin|hair|beauty|salon|spa|fitness|gym|yoga|sports|clubs?)\b/i;

  const TAGLINE_RE = /\b(dealers?|manufacturers?|mfrs?\.?|mfg\.?|suppliers?|exporters?|importers?|wholesalers?|retailers?|distributors?|stockists?|traders?|manufacturing)\s+(in|of|&|and|:)|\bspecialist(?:s)?\s+in\b|\bspecializ|\bspecialis|\bauthori[sz]ed\b|\ball\s+kinds?\s+of\b|\ball\s+types?\s+of\b|\bsince\s+\d{4}\b|\best(?:d|ablished)?\.?\s*:?\s*\d{4}\b|\bwe\s+(deal|provide|offer|are|make|build|create|help)\b|\byour\s+(partner|trusted|one[- ]stop)\b|\bone[- ]stop\b|\bsolutions?\s+for\b|\bservices?\s+(in|for)\b|\bhome\s+delivery\b|\b24\s*[x×\/]\s*7\b|\bopen\b.*\b(am|pm)\b|\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*[-–to]+\s*(mon|tue|wed|thu|fri|sat|sun)|\bcertif(?:ied|ield|led)\b|\biso\s*\d{4}|\bcommitted\s+to\b|\bdedicated\s+to\b|\bdriven\s+by\b|\bpractis?[ci]ng\s+at\b|\balso\s+at\b|\bavailable\s+at\b|\bapproved\b|\bvendor\b|\bclientele\b|\bour\s+(clients?|products?|services?|brands?)\b|\bassociated\s+with\b|\bsister\s+concern\b|\bgroup\s+compan|\balso\s+(deals?|available)\b|\bsubsidiary\s+of\b|\ba\s+(unit|division)\s+of\b|\bterms?\s*:|\bsubject\s+to\b|\bjurisdiction\b|\be\.?\s*&\s*o\.?\s*e\.?|\bsunday\s+closed\b|\bclosed\b|\btimings?\b|\bhours?\b|\bappointment\b|\bemergency\b|\bconsultation\b|\bopd\b|\bpurity\b|\btrust\b.*\bday\b|\bmoving\b|\bfor\s+(indie|small|your|every)\b|\binfrastructure\s+for\b|\bhello\b|\bhi,?\s+i'?m\b|\bproducts?\s*:|\bavailable\s*:|\bwe\s+also\b|\bcash\s+on\s+delivery\b|\bfree\s+(home\s+)?delivery\b|\bbest\s+(quality|price|rates?)\b|\bguarantee/i;
  const FUNCTION_WORDS = /\b(for|of|and|in|the|to|with|your|we|all|kinds|our|you|from|by|at|on|is|are|that|this|every|best|quality|trusted|leading|premium)\b/;
  const TIMING_RE = /\b\d{1,2}(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)\b/i;

  const ADDR_WORDS = /\b(road|rd\.?|street|st\.?|avenue|ave\.?|lane|ln\.?|marg|nagar|chowk|chauraha|bazaa?r|market|mkt|sector|phase|block|plot|floor|flr|ground floor|basement|shop|gali|wing|suite|ste\.?|unit|building|bldg|tower|towers|complex|arcade|plaza|heights|apartments?|apt\.?|society|colony|layout|cross|main|stage|extension|extn|enclave|vihar|puram|nagar|kunj|garden|gardens|park|near|opp\.?|opposite|behind|beside|above|below|next to|adjacent|industrial|indl\.?|area|estate|zone|dist\.?|distt\.?|district|tehsil|taluka|taluk|mandal|village|vill\.?|post|p\.?o\.?|g\.?p\.?o\.?|landmark|highway|hwy|bypass|circle|square|junction|jn\.?|station|gate|campus|city|town|pincode|pin\s*code|pin\s*[-:]|zip|p\.?\s?o\.?\s?box|po\s*box|office|regd\.?\s*office|registered\s*office|corporate\s*office|head\s*office|h\.?o\.?|branch|works|factory|showroom|godown|warehouse|address|add\.?|addr\.?|house|h\.?\s?no\.?|flat|no\.|#|km\s*stone|milestone|mile)\b/i;
  const ADDR_LABEL = /^\s*((?:regd\.?|registered|corporate|corp\.?|head|regional|zonal|area|sales|city|admin|main|branch|marketing|liaison|delhi|mumbai|[A-Za-z]+)\s*office(?:\s*\([^)]*\))?(?:\s*&\s*showroom)?|regd\.?\s*office\s*&\s*works|h\.?o\.?|branch|works|factory|unit|showroom|godown|warehouse|office|address|add\.?|addr\.?|regd\.?|res\.?|residence|home|clinic|chamber|hospital|store|shop|outlet|studio|gallery|site|plant|mill|depot|yard|correspondence(?:\s*address)?|mailing\s*address|postal\s*address)\s*[:\-–]\s*/i;

  const IN_STATES = {
    'andhra pradesh': 'Andhra Pradesh', 'ap': 'Andhra Pradesh', 'arunachal pradesh': 'Arunachal Pradesh', 'assam': 'Assam', 'bihar': 'Bihar',
    'chhattisgarh': 'Chhattisgarh', 'chattisgarh': 'Chhattisgarh', 'cg': 'Chhattisgarh', 'goa': 'Goa', 'gujarat': 'Gujarat', 'gj': 'Gujarat',
    'haryana': 'Haryana', 'hr': 'Haryana', 'himachal pradesh': 'Himachal Pradesh', 'hp': 'Himachal Pradesh', 'jharkhand': 'Jharkhand',
    'karnataka': 'Karnataka', 'ka': 'Karnataka', 'kerala': 'Kerala', 'kl': 'Kerala', 'madhya pradesh': 'Madhya Pradesh', 'mp': 'Madhya Pradesh',
    'maharashtra': 'Maharashtra', 'mh': 'Maharashtra', 'manipur': 'Manipur', 'meghalaya': 'Meghalaya', 'mizoram': 'Mizoram', 'nagaland': 'Nagaland',
    'odisha': 'Odisha', 'orissa': 'Odisha', 'punjab': 'Punjab', 'pb': 'Punjab', 'rajasthan': 'Rajasthan', 'rj': 'Rajasthan', 'sikkim': 'Sikkim',
    'tamil nadu': 'Tamil Nadu', 'tamilnadu': 'Tamil Nadu', 'tn': 'Tamil Nadu', 'telangana': 'Telangana', 'ts': 'Telangana', 'tripura': 'Tripura',
    'uttar pradesh': 'Uttar Pradesh', 'up': 'Uttar Pradesh', 'u.p.': 'Uttar Pradesh', 'uttarakhand': 'Uttarakhand', 'uk': 'Uttarakhand',
    'west bengal': 'West Bengal', 'wb': 'West Bengal', 'delhi': 'Delhi', 'new delhi': 'Delhi', 'ncr': 'Delhi', 'chandigarh': 'Chandigarh',
    'puducherry': 'Puducherry', 'pondicherry': 'Puducherry', 'jammu and kashmir': 'Jammu and Kashmir', 'jammu & kashmir': 'Jammu and Kashmir',
    'j&k': 'Jammu and Kashmir', 'ladakh': 'Ladakh', 'andaman and nicobar': 'Andaman and Nicobar Islands', 'lakshadweep': 'Lakshadweep',
    'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu', 'daman': 'Daman and Diu'
  };
  const IN_STATE_RE = new RegExp('\\b(' + Object.keys(IN_STATES).filter(k => k.length > 3).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|') + ')\\b', 'i');
  const IN_STATE_ABBR_RE = /\b(AP|CG|GJ|HR|HP|KA|KL|MP|MH|PB|RJ|TN|TS|UP|WB|UK)\b/;

  const CITIES = words(`
    mumbai bombay delhi newdelhi bengaluru bangalore hyderabad ahmedabad chennai madras kolkata calcutta surat pune jaipur
    lucknow kanpur nagpur indore thane bhopal visakhapatnam vizag patna vadodara baroda ghaziabad ludhiana agra nashik
    faridabad meerut rajkot varanasi srinagar aurangabad dhanbad amritsar allahabad prayagraj ranchi howrah coimbatore
    jabalpur gwalior vijayawada jodhpur madurai raipur kota chandigarh guwahati solapur hubli mysore mysuru tiruchirappalli
    trichy bareilly aligarh tiruppur tirupur moradabad jalandhar bhubaneswar salem warangal guntur bhiwandi saharanpur
    gorakhpur bikaner amravati noida jamshedpur bhilai cuttack firozabad kochi cochin nellore bhavnagar dehradun durgapur
    asansol rourkela nanded kolhapur ajmer akola gulbarga jamnagar ujjain loni siliguri jhansi ulhasnagar jammu mangalore
    mangaluru erode belgaum belagavi ambattur tirunelveli malegaon gaya jalgaon udaipur maheshtala gurgaon gurugram
    thiruvananthapuram trivandrum kozhikode calicut thrissur trichur kollam kannur palakkad alappuzha vellore hosur
    tirupati kakinada rajahmundry karimnagar nizamabad anantapur kurnool panipat sonipat karnal ambala rohtak hisar
    bhiwani yamunanagar sirsa mohali panchkula zirakpur patiala bathinda mandi shimla dharamshala haridwar rishikesh
    roorkee haldwani rudrapur ghazipur mathura vrindavan bhagalpur muzaffarpur darbhanga purnia bokaro deoghar hazaribagh
    sambalpur berhampur puri balasore silchar dibrugarh jorhat tezpur shillong agartala imphal aizawl kohima gangtok
    itanagar port blair panaji panjim margao vasco anand nadiad bharuch ankleshwar vapi valsad navsari mehsana gandhinagar
    gandhidham bhuj junagadh porbandar morbi palanpur ratlam dewas sagar satna rewa singrauli katni burhanpur khandwa
    bilaspur korba durg rajnandgaon raigarh ambikapur nagpur wardha chandrapur latur osmanabad satara sangli miraj karad
    ratnagiri sindhudurg alibag lonavala khopoli panvel navi kalyan dombivli badlapur vasai virar mira bhayandar boisar
    palghar pimpri chinchwad hinjewadi wakad hadapsar kharadi viman baner aundh kothrud whitefield marathahalli koramangala
    indiranagar jayanagar electronic yelahanka hebbal hosur bommanahalli madhapur gachibowli kukatpally secunderabad
    dilsukhnagar ameerpet begumpet banjara jubilee anna nagar velachery tambaram guindy adyar porur ambattur sholinganallur
    omr salt lake rajarhat newtown howrah dum behala garia okhla saket dwarka rohini pitampura janakpuri lajpat kalkaji
    nehru place connaught karol bagh rajouri vasant kunj greater faridabad ballabhgarh manesar sohna bahadurgarh bhiwadi
    alwar neemrana rewari dharuhera
    london manchester birmingham leeds glasgow edinburgh dublin new york newyork los angeles chicago houston phoenix
    philadelphia san antonio diego dallas jose austin jacksonville francisco columbus indianapolis seattle denver boston
    nashville detroit portland vegas memphis louisville baltimore milwaukee albuquerque tucson fresno sacramento atlanta
    miami orlando tampa charlotte raleigh pittsburgh cincinnati cleveland minneapolis toronto vancouver montreal calgary
    sydney melbourne brisbane perth auckland singapore kuala lumpur bangkok jakarta manila hong kong shanghai beijing
    shenzhen tokyo osaka seoul dubai abu dhabi sharjah ajman doha muscat riyadh jeddah dammam kuwait manama bahrain
    paris berlin munich frankfurt hamburg amsterdam brussels zurich geneva vienna madrid barcelona rome milan lisbon
    stockholm oslo copenhagen helsinki warsaw prague budapest moscow istanbul cairo nairobi lagos johannesburg cape town
    kathmandu dhaka chittagong colombo karachi lahore islamabad
  `);

  const COUNTRIES = /\b(india|usa|u\.s\.a\.?|united states|uk|u\.k\.?|united kingdom|england|uae|u\.a\.e\.?|united arab emirates|canada|australia|singapore|germany|deutschland|france|japan|china|nepal|bangladesh|sri lanka|pakistan|saudi arabia|ksa|qatar|oman|kuwait|bahrain|malaysia|thailand|indonesia|philippines|vietnam|south africa|nigeria|kenya|egypt|brazil|mexico|italy|italia|spain|españa|netherlands|switzerland|sweden|poland|russia|turkey|israel|ireland|new zealand|hong kong|mauritius|bhutan|myanmar|austria|belgium|portugal|greece|norway|denmark|finland)\b/i;

  const SOCIAL_HOSTS = {
    'linkedin.com': 'linkedin', 'lnkd.in': 'linkedin', 'instagram.com': 'instagram', 'instagr.am': 'instagram',
    'facebook.com': 'facebook', 'fb.com': 'facebook', 'fb.me': 'facebook', 'twitter.com': 'twitter', 'x.com': 'twitter',
    'youtube.com': 'youtube', 'youtu.be': 'youtube', 'tiktok.com': 'tiktok', 'github.com': 'github', 'wa.me': 'whatsapp',
    'whatsapp.com': 'whatsapp', 't.me': 'telegram', 'telegram.me': 'telegram', 'snapchat.com': 'snapchat',
    'pinterest.com': 'pinterest', 'behance.net': 'custom', 'dribbble.com': 'custom', 'medium.com': 'custom', 'threads.net': 'custom'
  };
  const SOCIAL_LABEL = /\b(linkedin|instagram|insta|ig|facebook|fb|twitter|x|youtube|yt|tiktok|github|telegram|snapchat|pinterest|behance|dribbble|threads)\b\s*[:.\-–]?\s*(@?[A-Za-z0-9_.\/-]{2,})/i;
  const SOCIAL_NET_BY_WORD = { linkedin: 'linkedin', instagram: 'instagram', insta: 'instagram', ig: 'instagram', facebook: 'facebook', fb: 'facebook', twitter: 'twitter', x: 'twitter', youtube: 'youtube', yt: 'youtube', tiktok: 'tiktok', github: 'github', telegram: 'telegram', snapchat: 'snapchat', pinterest: 'pinterest', behance: 'custom', dribbble: 'custom', threads: 'custom' };
  const SOCIAL_HOME = { linkedin: 'https://linkedin.com/in/', instagram: 'https://instagram.com/', facebook: 'https://facebook.com/', twitter: 'https://x.com/', youtube: 'https://youtube.com/@', tiktok: 'https://tiktok.com/@', github: 'https://github.com/', telegram: 'https://t.me/', snapchat: 'https://snapchat.com/add/', pinterest: 'https://pinterest.com/' };

  const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|rocketmail|hotmail|outlook|live|msn|aol|icloud|me|mac|rediffmail|rediff|protonmail|proton|pm|zoho|mail|gmx|yandex|inbox|fastmail|hey|tutanota|sify|indiatimes|in)\./i;

  const TLDS = 'com|in|co\\.in|net\\.in|org\\.in|org|net|io|co|biz|info|dev|ai|me|us|uk|co\\.uk|ae|sg|au|com\\.au|ca|de|fr|it|es|nl|jp|cn|hk|nz|za|tech|store|online|site|xyz|shop|life|world|agency|solutions|services|digital|studio|design|group|global|company|business|pro|app|cloud|edu|gov|ac\\.in|edu\\.in|gov\\.in|nic\\.in|res\\.in|firm\\.in|gen\\.in|ind\\.in|health|clinic|law|legal|realty|properties|estate|travel|tours|events|photography|art|media|news|blog|club|team|network|systems|technology|consulting|finance|capital|fund|bank|insure|money|pk|lk|np|bd|my|th|id|ph|vn|kr|tw|ru|tr|eg|ng|ke|mx|br|ar|cl|se|no|dk|fi|pl|cz|at|ch|be|pt|gr|ie|il|qa|om|kw|bh|sa';
  const RE_EMAIL = new RegExp('[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.(?:' + TLDS + '|[A-Za-z]{2,})', 'g');
  const RE_URL = /(https?:\/\/[^\s|]+|www\.[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+(?:\/[^\s|]*)?)/gi;
  const RE_BARE_DOMAIN = new RegExp('(^|[\\s|:,(])((?:[A-Za-z0-9\\-]+\\.)+(?:' + TLDS + '))(\\/[^\\s|,)]*)?(?=$|[\\s|,)])', 'gi');
  const RE_PHONE = /(?:\+?\(?\d[\d\s\-—–.()]{5,}\d)/g;
  const RE_PIN_IN = /\b\d{6}\b/;
  const RE_ZIP_US = /\b\d{5}(?:-\d{4})?\b/;
  const RE_POSTCODE_UK = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/;
  const RE_GSTIN = /\b(\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/;
  const RE_PAN = /\b([A-Z]{5}\d{4}[A-Z])\b/;
  const RE_CIN = /\b([LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\b/;
  const ID_LABEL = /\b(G[S5][T7][I1l]N(?:\s*No\.?)?|GST\s*(?:IN|No\.?|Reg\.?\s*No\.?|Number)?|GSTN|CIN|LLPIN|PAN(?:\s*No\.?)?|TIN|VAT(?:\s*(?:No\.?|ID|Reg\.?\s*No\.?))?|TAN|IEC|MSME(?:\s*No\.?)?|Udyam(?:\s*Reg\.?\s*No\.?)?|(?:[A-Z]{2,6}\s+)?Reg(?:d|istration)?\.?\s*No\.?|(?:[A-Z]{2,6}\s+)?Regn\.?\s*No\.?|Membership\s*No\.?|Mem\.?\s*No\.?|(?:[A-Z]{2,6}\s+)?Lic(?:ense|ence)?\.?\s*No\.?|DL\s*No\.?|IRDA(?:I)?\s*(?:Reg\.?\s*)?No\.?|ARN|AMFI|SEBI\s*Reg\.?\s*No\.?|RERA(?:\s*No\.?)?|FSSAI(?:\s*No\.?)?|Enrol(?:l)?ment\s*No\.?|Bar\s*Council\s*No\.?|IMR?C\s*No\.?|NMC\s*No\.?|COA\s*No\.?|D\.?L\.?\s*No\.?|Roll\s*No\.?|USt\.?-?\s?Id\.?-?\s?Nr\.?|USt\.?-?Id|Steuer\s*-?\s*Nr\.?|St\.?-?Nr\.?|HRB|HRA|Handelsregister|SIRET|SIREN|TVA|P\.?\s?IVA|NIF|CIF|EIN|ABN|ACN|KvK|BTW|NIP|REGON|Company\s*(?:Reg\.?\s*)?No\.?|Co\.?\s*Reg\.?\s*No\.?|Trade\s*Lic(?:ense|ence)?\.?\s*(?:No\.?)?|TL\s*No\.?|CR\s*No\.?|TRN)\s*[:.\-–]?\s*([A-Z0-9][A-Z0-9\/\-\.]*(?:\s+[A-Z0-9][A-Z0-9\/\-\.]{1,}){0,4})/i;
  // short acronym labels are only IDs when a separator follows or the value looks like a code
  const ID_SHORT_LABEL = /^(pan|tin|tan|iec|arn|trn|amfi|rera|fssai|nif|cif|ein|abn|acn|kvk|btw|nip|hrb|hra|tva|siret|siren|cin|llpin|gstn)$/i;

  // contact-point labels (NOT address labels — those are kept so address grouping can see them).
  // Multi-letter labels may be followed by any punctuation; single letters ("M", "E", "W", "T", "F", "P")
  // need a colon/dash/pipe so "M.G. Road" or "P.O. Box" are never mistaken for labels.
  const LABEL_JUNK = /^\s*(?:(?:tel(?:ephone)?|tél|telefon|tell|phone|ph|mob(?:ile|il)?|handy|cell|whatsapp|wa|call|off(?:ice)?|work|fax|telefax|email|e-?ma[il1]l?|e-?mall|mail|web(?:site)?|url|www|res(?:idence)?|resi|direct|dlrect|dir|toll\s*free|board|hp|hand\s*phone|contact(?:\s*no)?|ph\s*no|mob\s*no|landline|land\s*line|std|isd|skype|visit(?:\s*us)?(?:\s*at)?|website|site|link|profile|emergency|helpline|customer\s*care|enquiry|enquiries|reception|appointment)\s*(?:no\.?|number|#)?\s*[:.\-–|]+|[MEWTFPODH]\s*[:|]+)\s*/i;
  // words that may be left over once the number/email after them is extracted
  const LABEL_LEFTOVER = /^\s*(?:tel(?:ephone)?|phone|ph|mob(?:ile|il)?|cell|whatsapp|off(?:ice)?|work|fax|email|e-?mail|mail|web(?:site)?|res(?:idence)?|home|direct|toll\s*free|board|contact|landline|clinic|chamber|hosp(?:ital)?|emergency|helpline|customer\s*care|enquiry|enquiries|reception|appointment|sales|support|desk|visit(?:\s*us)?|call|www)\s*(?:no\.?|number|us|at|id|address|link)?\s*[:.\-–|]*\s*$/i;
  const LABEL_SINGLE = /^\s*([MTFEWPODH]|Ph|Tel|Mob|Fax|Off|Res|Dir|Web|Cell|WA|HP)\s*[:.\-–]?\s+(?=\S)/i;

  /* ================= helpers ================= */

  const digits = s => (s || '').replace(/\D/g, '');
  const squash = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const wordsOf = s => (s || '').split(/\s+/).filter(Boolean);

  function repairEmailChars(s) {
    return s
      // meIissa → melissa: a capital I inside an otherwise-lowercase token is a misread "l"
      // (leave CamelCase like "GuptaIndustries" alone)
      .replace(/[^\s@.]+/g, tok => (/[A-HJ-Z]/.test(tok) ? tok : tok.replace(/(?<=[a-z])I(?=[a-z])/g, 'l')))
      .replace(/[©®ⓐ]/g, '@')                              // © ® ⓐ → @
      .replace(/\b(visit(?:\s+us)?|us|at|online|web|website|see)\s*@\s*(?=(?:www\.)?[a-z0-9-]+\.)/gi, ' ')   // "Visit us @ www.x.in" is a URL
      .replace(/@\s*(?=www\.)/gi, ' ')
      .replace(/\s*[\[({]\s*(?:at|a|@)\s*[\])}]\s*/gi, '@')                 // (at) [at] (a)
      .replace(/(\w)\s+at\s+(\w[\w-]*\s*[.,]\s*\w{2,})/gi, '$1@$2')       // "name at domain . com"
      .replace(/\s*@\s*/g, '@')                                            // spaces around @
      .replace(/(@[A-Za-z0-9\-]+)\s*[.,]\s*(?=[A-Za-z]{2,})/g, '$1.')      // "domain , com" / "domain . com"
      .replace(/(@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*)\s+([A-Za-z]{2,4})\b(?=\s|$)/g, (m, a, b) => /^(com|in|net|org|co|io)$/i.test(b) ? a + '.' + b : m)
      .replace(/\.c[o0]rn\b/gi, '.com').replace(/\.c0m\b/gi, '.com').replace(/\.corn\b/gi, '.com')
      .replace(/\.[c\(][o0]m\b/gi, '.com')
      .replace(/gmai[l1]\.c/gi, 'gmail.c').replace(/gmali\./gi, 'gmail.').replace(/gamil\./gi, 'gmail.').replace(/gmial\./gi, 'gmail.')
      .replace(/yah00\./gi, 'yahoo.').replace(/hotmai[l1]\./gi, 'hotmail.').replace(/out[l1]ook\./gi, 'outlook.')
      .replace(/rediffmai[l1]\./gi, 'rediffmail.');
  }

  function repairUrlChars(s) {
    return s
      .replace(/\bw{2}[vw]\s*[.,]/gi, 'www.').replace(/\bvvww\s*[.,]/gi, 'www.').replace(/\bwww\s+(?=[a-z0-9-]+\s*[.,])/gi, 'www.')
      .replace(/\bwww\s+([a-z0-9-]{3,})\s+(com|in|net|org|co|io|biz|info)\b/gi, 'www.$1.$2')      // "www acme com"
      .replace(/\bwww\s*[.,]\s*/gi, 'www.')
      .replace(/(www\.[A-Za-z0-9\-]+)\s*[.,]\s*(?=[A-Za-z]{2,})/g, '$1.')
      .replace(/(www\.[A-Za-z0-9\-]+)\s+([A-Za-z]{2,4})\b/g, (m, a, b) => /^(com|in|net|org|co|io|biz|info)$/i.test(b) ? a + '.' + b : m)
      .replace(/([A-Za-z0-9\-]+)\s*[.,]\s*(com|in|net|org|co\.in|io|biz|info)\b(?![.\w])/gi, '$1.$2')
      .replace(/\.c[o0]rn\b/gi, '.com').replace(/\.c0m\b/gi, '.com')
      .replace(/https?\s*:\s*\/\s*\/\s*/gi, 'https://');
  }

  const PHONE_CONFUSABLES = { O: '0', o: '0', I: '1', l: '1', '|': '1', S: '5', B: '8', Z: '2', D: '0', Q: '0' };
  function repairPhoneChars(s) {
    // per whitespace token: only tokens that are ≥3 digits with at most a
    // couple of confusable letters and NO other letters ("98l10" → "98110")
    return s.replace(/[^\s]+/g, tok => {
      if (!/\d/.test(tok)) return tok;
      const d = (tok.match(/\d/g) || []).length;
      const conf = (tok.match(/[OoIlSBZDQ|]/g) || []).length;
      const other = (tok.match(/[A-Za-z]/g) || []).length - (tok.match(/[OoIlSBZDQ]/g) || []).length;
      if (d < 3 || conf === 0 || conf > 2 || other > 0) return tok;
      return tok.replace(/[OoIlSBZDQ|]/g, c => PHONE_CONFUSABLES[c] || c);
    });
  }

  // "Sales Mana ger" → "Sales Manager", "P R O P R I E T O R" → "PROPRIETOR"
  const JOINABLE = new Set(('manager director engineer executive marketing consultant developer designer president proprietor ' +
    'proprietress partner officer assistant associate specialist coordinator administrator accountant advocate architect ' +
    'analyst supervisor secretary chairman chairperson founder cofounder technician physician surgeon dentist professor ' +
    'lecturer principal counsellor counselor therapist trainer photographer journalist editor operations business ' +
    'development finance accounts purchase production quality logistics electronics electricals enterprises industries ' +
    'traders exports imports solutions technologies systems services international company limited private hospital ' +
    'clinic pharmacy jewellers textiles garments furniture properties builders developers').split(' '));
  function repairSplitWords(text) {
    let t = text;
    if (/^(?:[A-Za-z]\s){3,}[A-Za-z]$/.test(t.trim())) t = t.replace(/\s+/g, '');
    const toks = t.split(' ');
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      const a = toks[i], b = toks[i + 1];
      if (b && /^[A-Za-z]+$/.test(a) && /^[A-Za-z]+$/.test(b) && JOINABLE.has((a + b).toLowerCase()) && !JOINABLE.has(a.toLowerCase()) && !JOINABLE.has(b.toLowerCase())) {
        out.push(a + b); i++;
      } else out.push(a);
    }
    return out.join(' ');
  }

  // "5ummit" → "Summit", "IS0" → "ISO", "MlDC" → "MIDC" (conservative: never emails/URLs/CamelCase)
  function repairWordDigits(text) {
    return text.replace(/[^\s]+/g, tok => {
      if (/^\d+(st|nd|rd|th)$/i.test(tok) || /[@\/]|www\.|\.[a-z]{2,4}$/i.test(tok)) return tok;
      let t = tok;
      if (/^[0158][a-z]{3,}$/.test(t)) t = ({ '0': 'O', '1': 'I', '5': 'S', '8': 'B' })[t[0]] + t.slice(1);
      const upper = (t.match(/[A-Z]/g) || []).length;
      const lower = (t.match(/[a-z]/g) || []).length;
      const conf = (t.match(/[0l1]/g) || []).length;
      // only ALL-CAPS-ish tokens (the lone lowercase may be the misread "l"); UK postcode outward
      // codes ("SE1", "EC1A") and similar short codes end in a digit — leave them
      if (upper >= 2 && lower <= 1 && conf === 1 && t.length >= 3 && !/\d{2}/.test(t) && !/[-\/]/.test(t) && !/^[A-Z]{1,2}[1-9][A-Z]?$/.test(t)) {
        t = t.replace(/0/g, 'O').replace(/l/g, 'I').replace(/1/g, 'I');
      }
      return t;
    });
  }

  function fixGstin(raw) {
    // 15 chars: 2 digits, 5 letters, 4 digits, 1 letter, 1 alnum, 'Z', 1 alnum
    let s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (s.length !== 15) return null;
    const toD = c => ({ O: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', D: '0', Q: '0', G: '6', T: '7' }[c] || c);
    const toL = c => ({ '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z', '6': 'G', '4': 'A' }[c] || c);
    const out = s.split('');
    for (let i = 0; i < 15; i++) {
      if (i < 2 || (i >= 7 && i < 11)) out[i] = toD(out[i]);
      else if (i < 7 || i === 11) out[i] = toL(out[i]);
      else if (i === 13) out[i] = 'Z';
    }
    const fixed = out.join('');
    return RE_GSTIN.test(fixed) ? fixed : (fixed.length === 15 ? fixed : null);
  }

  function normUrl(u) {
    u = (u || '').trim().replace(/[|,.;:)]+$/, '');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/*/, '');
    // lower-case host only
    return u.replace(/^(https?:\/\/)([^\/]+)/, (m, p, h) => p + h.toLowerCase());
  }
  function hostOf(u) {
    try { return new URL(normUrl(u)).hostname.replace(/^www\./i, '').toLowerCase(); }
    catch (e) { return ''; }
  }
  function socialFromHost(host) {
    if (!host) return null;
    if (SOCIAL_HOSTS[host]) return SOCIAL_HOSTS[host];
    const k = Object.keys(SOCIAL_HOSTS).find(h => host.endsWith('.' + h));
    return k ? SOCIAL_HOSTS[k] : null;
  }

  function isCapsWord(w) { return /^\p{Lu}[\p{Lu}'’.\-]*$/u.test(w) && /\p{Lu}{2}/u.test(w); }
  function isTitleWord(w) {
    return /^\p{Lu}[\p{Ll}'’\-]+\.?$/u.test(w) || /^\p{Lu}\.?$/u.test(w) || /^(?:\p{Lu}\.){1,3}$/u.test(w) ||
      /^(?:Mc|Mac|O'|D')\p{Lu}\p{Ll}+$/u.test(w) || /^(?:de|van|von|der|den|del|da|di|le|la|du|dos|das|do|bin|binti|ibn|ul|al|el|e|y)$/.test(w);
  }

  /* ================= line normalisation ================= */

  function cleanLine(t) {
    let s = (t || '');
    // wide gaps (two-column layouts) become explicit "‖" separators before whitespace collapse
    s = s.replace(/[ \t]{3,}/g, ' ‖ ').replace(/\s+/g, ' ').trim();
    s = s.replace(/^[|\\\/~_\-–—=*#>:;.,'"`´‘’“”«»<]+\s*/, '').replace(/\s*[|\\\/~_\-–—=*#<>:;'"`´‘’“”«»]+$/, '');
    s = s.replace(/\s*\|\s*\|\s*/g, ' | ');
    s = s.replace(/^\s*(?:hello|hi|hey|namaste|namaskar|greetings)[,!]?\s*(?:i'?m|i am|this is|my name is)?\s*$/i, '');
    s = s.replace(/\s*\((?:he|she|they)\s*\/\s*(?:him|her|them)(?:\s*\/\s*(?:his|hers|theirs))?\)/gi, '');
    s = s.replace(/^\s*m\/s\.?\s+/i, '');                                   // "M/s. Jai Bharat Electricals"
    // glued initials "R.K.Sharma" → "R.K. Sharma" — but never split degree abbreviations ("B.Com", "M.Sc.", "B.Tech")
    s = s.replace(/\b(\p{Lu}\.)(?=\p{Lu}\p{Ll})(?!(?:Com|Sc|Tech|Pharm|Phil|Ed|Arch|Des|Lib|Voc|Stat|Eng|Ch|Fin|Sci|Ing|Med|Surg|Ortho|Dent|Nurs|Opt|Vet|Ped|Lit|Mus|Th|Div|Sw|Pt|Sc)\b)/gu, '$1 ');
    s = repairSplitWords(repairWordDigits(s));
    s = repairNameCase(s);
    return s.trim();
  }

  // "Dr. Meera lyer" → "Dr. Meera Iyer": OCR reads a capital I as lowercase l. Only touch a token
  // that starts with "l" + lowercase letters when the rest of the line is Title Case and either the
  // corrected word is a known name or the line carries an honorific.
  function repairNameCase(s) {
    const toks = s.split(' ');
    if (toks.length < 2 || toks.length > 5) return s;
    const others = toks.filter(w => !/^l[a-z]{2,}$/.test(w));
    if (others.length === toks.length) return s;
    if (!others.every(w => /^\p{Lu}[\p{Ll}.'\-]*$/u.test(w) || /^\p{Lu}\.?$/u.test(w))) return s;
    const hasPrefix = NAME_PREFIX.test(s);
    return toks.map(w => {
      if (!/^l[a-z]{2,}$/.test(w)) return w;
      const fixed = 'I' + w.slice(1);
      const known = SURNAMES.has(fixed.toLowerCase()) || FIRST_NAMES.has(fixed.toLowerCase());
      return (known || hasPrefix) ? fixed : w;
    }).join(' ');
  }

  function isGarbage(text, conf) {
    const letters = (text.match(/[\p{L}\p{N}]/gu) || []).length;
    if (letters < 2) return true;
    const ratio = letters / text.length;
    if (ratio < 0.45) return true;
    if (conf < 30 && !/@|\d{5,}|www\./i.test(text)) return true;
    // one-word tokens of nonsense: consonant strings
    if (/^[^aeiouAEIOU\d\s]{5,}$/.test(text)) return true;
    // 1-3 letter logo monograms ("SS", "PB", "S8P", "VPE ®") — but keep real acronyms ("CEO", "MD", "L&T", "HR")
    if (/^[A-Z0-9&.]{1,3}\s*[®™©]?$/.test(text.trim()) &&
        !/^(ceo|cto|cfo|coo|cmo|cio|cso|md|vp|gm|hr|it|cs|ca|cma|dgm|agm|avp|evp|svp|mla|mp|dr|adv|er|ar|prop|l&t|m&m|p&g|j&k|h&m|d&b|a&m|b&b)$/i.test(text.trim().replace(/\s*[®™©]$/, ''))) return true;
    // gibberish from non-Latin scripts read as Latin: "aJlgall al,ll ¢,LaJ Jgill", "cyfl (WGHTGB QAM6DENEO"
    // (never for lines carrying IDs / codes such as "G5TIN : 07AAACS1234A1Z5")
    if (ID_LABEL.test(text) || RE_GSTIN.test(text.toUpperCase()) || /\b[A-Z0-9]{10,}\b/.test(text)) return false;
    const toks = text.split(/\s+/).filter(Boolean).map(w => w.replace(/^[(\["'.,]+|[)\]"'.,]+$/g, ''));
    const weird = toks.filter(w => /[a-z][A-Z]/.test(w) || (/[A-Za-z]\d[A-Za-z]/.test(w) && w.length <= 9) || /^[^aeiouAEIOUyY\W\d]{4,}$/.test(w) || /[¢¤§¶‡†¬]/.test(w) || /[A-Za-z],[A-Za-z]/.test(w) || (/^[A-Z]{5,}$/.test(w) && !/[AEIOU]/.test(w))).length;
    if (weird >= 2 && weird >= toks.length * 0.4) return true;
    return false;
  }

  /* ================= segments ================= */

  const SEP_RE = /\s*(?:‖|\|\||\|| • | · | ● | ◆ | ★ | ■ | ▪ | ♦ | ✆ | ☎ | ✉ | ✓ |\s\/\s|\s;\s)\s*/;

  /**
   * Split a line into logically separate segments (name | title, M … | E …).
   * Splitting on comma / dash only when the halves are of different kinds.
   * Returns [{text, emRight, twoCol}].
   */
  function segmentLine(text) {
    const twoCol = text.includes('‖');
    let parts = text.split(SEP_RE).map(s => s.trim()).filter(Boolean);
    // rejoin pieces that were split in the middle of a phone/email/url, or a label from its value
    const out = [];
    for (const p of parts) {
      const prev = out[out.length - 1];
      const prevIsLabel = prev && /^[A-Za-z][A-Za-z.\/\s]{0,14}$/.test(prev) && (LABEL_JUNK.test(prev + ':') || LABEL_LEFTOVER.test(prev)) && /^[+(\d@]|^www\./i.test(p);
      if (prev && (prevIsLabel || /[@.]$/.test(prev) || /^[@.]/.test(p) || (/\d$/.test(prev) && /^\d/.test(p) && digits(prev + p).length <= 13 && !/[A-Za-z]/.test(prev + p)))) {
        out[out.length - 1] = prev + (/[@.]$/.test(prev) || /^[@.]/.test(p) ? '' : ' ') + p;
      } else out.push(p);
    }
    // name , title  /  name - title  /  title — department
    const more = [];
    const push = (text, emRight) => more.push({ text, emRight: !!emRight, twoCol });
    for (const p of out) {
      // em-dash: "Regional Head (North) — Retail Banking" → title | department
      const em = /^(.{3,60}?)\s+—\s+(.{2,40})$/.exec(p);
      if (em && TITLE_RE.test(em[1]) && !/@|www\.|\d{4,}/.test(p)) { push(em[1].trim()); push(em[2].trim(), true); continue; }
      const m = /^(.{3,40}?)\s*(?:,|\s[-–—]\s)\s*(.{3,60})$/.exec(p);
      if (m && !/@|www\.|\d{4,}/.test(p)) {
        const a = m[1].trim(), b = m[2].trim();
        // a "name" half must be a real-looking person name (2+ words or a dictionary hit), so that
        // "Head - Cardiology" / "Director - Sales" stay one title
        const nameish = x => nameShape(x) && !TITLE_RE.test(x) && !DEGREES.test(stripPrefixes(x).core) &&
          (wordsOf(stripPrefixes(x).core).length >= 2 || FIRST_NAMES.has(x.toLowerCase()) || SURNAMES.has(x.toLowerCase()));
        const aName = nameish(a), bTitle = TITLE_RE.test(b) || DEGREES.test(b);
        const aTitle = TITLE_RE.test(a), bName = nameish(b);
        if ((aName && bTitle) || (aTitle && bName)) { push(a); push(b); continue; }
      }
      push(p);
    }
    return more;
  }

  // "Adv. Rajendra K. Bhargava, B.Sc., LL.B." → name + qualifications
  function splitNameDegrees(t) {
    const parts = t.split(/\s*,\s*/);
    if (parts.length < 2) return { name: t, degrees: '' };
    const head = parts[0];
    const tail = parts.slice(1);
    if (tail.every(x => DEGREES.test(x) || /^\(?[A-Za-z. ]{1,12}\)?$/.test(x) && DEGREES.test(x.replace(/[()]/g, '')))) {
      return { name: head, degrees: tail.join(', ') };
    }
    return { name: t, degrees: '' };
  }

  /** Strip stacked / parenthesised honorifics: "Prof. Dr. (Mrs.) Sunita Sharma" → core "Sunita Sharma". */
  function stripPrefixes(t) {
    let s = (t || '').trim();
    const prefixes = [];
    for (let guard = 0; guard < 4; guard++) {
      s = s.replace(/^\s*\((?:mrs|ms|miss|smt|dr|mr)\.?\)\s*/i, '');
      const pm = s.match(NAME_PREFIX);
      if (!pm) break;
      prefixes.push(pm[0].trim().replace(/[.:]+$/, '').replace(/\s*\(.*\)$/, '').trim());
      s = s.slice(pm[0].length);
    }
    return { core: s.trim(), prefixes };
  }

  function nameShape(t) {
    let s = splitNameDegrees(t.replace(/[,.]+$/, '').trim()).name;
    s = stripPrefixes(s).core.replace(/[,.]+$/, '').trim();
    s = s.replace(/\s*[\(\[].*?[\)\]]\s*$/, '');           // "(Ortho)" suffixes
    const ws = wordsOf(s);
    if (ws.length < 1 || ws.length > 4) return false;
    if (/\d|@|\/|:|www|\.com|&/.test(s)) return false;
    // all-lowercase names ("rakesh sharma") only when the dictionary recognises them
    if (ws.length >= 2 && ws.every(w => /^[a-z'’\-]+$/.test(w))) {
      return FIRST_NAMES.has(ws[0]) || ws.slice(1).some(w => SURNAMES.has(w));
    }
    if (!ws.every(w => isTitleWord(w) || isCapsWord(w))) return false;
    const letters = s.replace(/[^\p{L}]/gu, '').length;
    return letters >= 3 && letters <= 40;
  }

  /* ================= structured extraction ================= */

  function extractStructured(seg, ctx) {
    // ctx: { fields, seen: {emails,phones,urls,ids}, line }
    let rest = seg;
    let consumed = false;
    const F = ctx.fields, S = ctx.seen;

    // ---- IDs (GSTIN / PAN / CIN / Reg. No.) — before phones so digits aren't eaten ----
    let idm = ID_LABEL.exec(rest);
    if (idm) {
      // "Pan India Logistics" / "TRN Retail" — a bare short label with no separator and a wordy value is not an ID
      const between = rest.slice(idm.index + idm[1].length, idm.index + idm[0].length - idm[2].length);
      const rawVal = idm[2];
      if (ID_SHORT_LABEL.test(idm[1].trim()) && !/[:\-–]/.test(between) && !(/\d/.test(rawVal) && rawVal.replace(/[^A-Za-z0-9]/g, '').length >= 6)) idm = null;
      // preceded by "Email"/"Pin"/"Post" etc. → not an ID label
      else if (/\b(e-?mail|mail|pin|post|zip|area|std|isd|dial|country|city|hs|hsn|sac|item|product|model|qr|bar|promo|coupon|discount|offer|order|ref|dress)\s*$/i.test(rest.slice(0, idm.index))) idm = null;
    }
    if (idm) {
      let key = idm[1].replace(/\s+/g, ' ').replace(/\.$/, '').trim();
      let val = idm[2].replace(/[.,;:]+$/, '');
      const kU = key.toUpperCase();
      if (/^G[S5][T7]/.test(kU)) { key = 'GSTIN'; const g = fixGstin(val); if (g) val = g; }
      else if (/^PAN/.test(kU)) key = 'PAN';
      else if (/^CIN/.test(kU)) key = 'CIN';
      else if (/^UST/.test(kU)) key = 'USt-IdNr';
      else key = key.replace(/\bNo\b(?!\.)/i, 'No.').replace(/\.\./g, '.').replace(/\s+/g, ' ');
      const valDigits = digits(val).length;
      // reject values that are really a phone / PIN following a generic label ("Code", "ID")
      if (/^(code|id)$/i.test(key) && valDigits >= 7) { idm = null; }
      if (idm && val.replace(/[^A-Za-z0-9]/g, '').length >= 4 && !S.ids.has(key + val)) {
        S.ids.add(key + val);
        F.push({ category: 'custom', value: key + ': ' + val, confidence: 'high', data: { key, value: val } });
      }
      if (idm) { rest = rest.replace(idm[0], ' '); consumed = true; }
    }
    if (!idm) {
      const g = RE_GSTIN.exec(rest.toUpperCase().replace(/[^A-Z0-9 ]/g, ' '));
      if (g && !S.ids.has('GSTIN' + g[1])) {
        S.ids.add('GSTIN' + g[1]);
        F.push({ category: 'custom', value: 'GSTIN: ' + g[1], confidence: 'high', data: { key: 'GSTIN', value: g[1] } });
        rest = rest.replace(new RegExp(g[1], 'i'), ' ');
        consumed = true;
      }
    }

    // ---- emails ----
    if (/@|\((?:at|a)\)|\[(?:at|a)\]|©/i.test(rest)) {
      let src = repairEmailChars(rest.replace(LABEL_JUNK, ' ').replace(LABEL_SINGLE, ' '));
      RE_EMAIL.lastIndex = 0;
      const found = src.match(RE_EMAIL) || [];
      for (let em of found) {
        em = em.replace(/^[^A-Za-z0-9]+/, '').replace(/[.,;:]+$/, '').toLowerCase();
        // a single-letter label glued to the local part ("epriya@…" from "E priya@…")
        if (S.emails.has(em)) continue;
        S.emails.add(em);
        F.push({ category: 'email', value: em, confidence: 'high' });
        consumed = true;
      }
      if (found.length) rest = src.replace(RE_EMAIL, ' ');
    }

    // ---- explicit URLs ----
    rest = repairUrlChars(rest);
    RE_URL.lastIndex = 0;
    const urls = rest.match(RE_URL) || [];
    for (const u of urls) {
      const url = normUrl(u);
      const host = hostOf(url);
      if (!host || S.urls.has(url)) continue;
      S.urls.add(url);
      const social = socialFromHost(host);
      if (social) F.push({ category: 'social', value: url, confidence: 'high', data: { network: social } });
      else F.push({ category: 'website', value: url, confidence: 'high' });
      consumed = true;
    }
    if (urls.length) rest = rest.replace(RE_URL, ' ');

    // ---- bare domains ----
    let bare;
    RE_BARE_DOMAIN.lastIndex = 0;
    const bareFound = [];
    while ((bare = RE_BARE_DOMAIN.exec(rest)) !== null) bareFound.push(bare);
    for (const b of bareFound) {
      const dom = b[2].toLowerCase(), path = b[3] || '';
      // "B.Tech", "M.Com", "B.Ed." are degrees, not domains; real domains have a ≥2-char label
      if (/^[a-z]\./.test(dom) || DEGREES.test(b[2])) continue;
      if (S.urls.has('https://' + dom + path)) continue;
      if ([...S.emails].some(e => e.endsWith('@' + dom)) && !path) { rest = rest.replace(b[0], ' '); consumed = true; continue; }
      S.urls.add('https://' + dom + path);
      const social = socialFromHost(dom);
      if (social) F.push({ category: 'social', value: 'https://' + dom + path, confidence: 'high', data: { network: social } });
      else F.push({ category: 'website', value: 'https://' + dom + path, confidence: 'medium' });
      rest = rest.replace(b[0], ' ');
      consumed = true;
    }

    // ---- social handles with a network word ("Instagram: @rakesh", "IG @x") ----
    const sm = SOCIAL_LABEL.exec(rest);
    if (sm && !/@.*\./.test(sm[2])) {
      const net = SOCIAL_NET_BY_WORD[sm[1].toLowerCase()];
      let handle = sm[2].replace(/^@/, '').replace(/[.,;:]+$/, '');
      if (net && handle.length >= 2 && !/^(com|in|net)$/i.test(handle)) {
        const base = SOCIAL_HOME[net] || 'https://';
        const url = base + handle;
        if (!S.urls.has(url)) {
          S.urls.add(url);
          F.push({ category: 'social', value: url, confidence: 'medium', data: { network: net } });
        }
        rest = rest.replace(sm[0], ' ');
        consumed = true;
      }
    }

    // ---- bare social handle "@mayamakes" (no domain) ----
    const hm = /(^|[\s|,])@([A-Za-z0-9_.]{2,30})(?![.\w]*\.[a-z])/i.exec(rest);
    if (hm && !/@[\w.-]+\.[a-z]{2,}/i.test(rest)) {
      const handle = hm[2].replace(/[.,]+$/, '');
      const net = /\b(insta|instagram|ig)\b/i.test(ctx.line) ? 'instagram' : /\b(twitter|x)\b/i.test(ctx.line) ? 'twitter' : 'instagram';
      const url = (SOCIAL_HOME[net] || 'https://instagram.com/') + handle;
      if (!S.urls.has(url)) { S.urls.add(url); F.push({ category: 'social', value: url, confidence: 'low', data: { network: net, handle: '@' + handle } }); }
      rest = rest.replace(hm[0], ' ');
      consumed = true;
    }

    // ---- phones (skip clock-time ranges like "10.30 - 1.30") ----
    let pm, phoneCount = 0;
    const isTiming = TIMING_RE.test(rest) || /\b\d{1,2}[.:]\d{2}\s*(?:[-–to]+|&)\s*\d{1,2}[.:]\d{2}\b/.test(rest);
    let psrc = isTiming ? '' : repairPhoneChars(rest);
    RE_PHONE.lastIndex = 0;
    const pmatches = [];
    while ((pm = RE_PHONE.exec(psrc)) !== null) pmatches.push({ m: pm[0], i: pm.index });
    for (const { m, i } of pmatches) {
      let num = m.trim();
      const d = digits(num);
      if (d.length < 7 || d.length > 15) continue;
      if (/^(19|20)\d{2}$/.test(d)) continue;
      // date-like "12.03.2019" / "2009/03/2417", US ZIP+4 "10005-1402"
      if (/^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}$/.test(num)) continue;
      if (/^\d{5}-\d{4}$/.test(num) || US_CITY_STATE_ZIP.test(seg)) continue;
      if (S.phones.has(d.slice(-10))) continue;
      S.phones.add(d.slice(-10));
      const context = psrc.slice(Math.max(0, i - 18), i);
      const after = psrc.slice(i + m.length, i + m.length + 16);
      // when the line was split into segments, only this segment's words describe the number
      let cat = classifyPhone(context, seg, num, ctx.phoneIndex++, after);
      let val = cleanPhone(num);
      const ext = /^\s*\(?\s*(?:ext|extn|x)\.?\s*[:.]?\s*(\d{1,5})/i.exec(after);
      if (ext) val += ' ext. ' + ext[1];
      F.push({ category: cat, value: val, confidence: 'high' });
      consumed = true;
      phoneCount++;
    }
    if (phoneCount) rest = psrc.replace(RE_PHONE, ' ').replace(/\(?\b(?:ext|extn|x)\.?\s*[:.]?\s*\d{1,5}\)?/gi, ' ');

    // ---- leftover text ----
    rest = rest.replace(LABEL_JUNK, ' ').replace(/^\s*(?:e|w|m|t|f|p)\s*[:.]\s*$/i, '').replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim();
    rest = rest.replace(/^[,;:\-–—.\s]+|[,;:\-–—\s]+$/g, '');
    if (consumed && LABEL_LEFTOVER.test(rest)) rest = '';                      // "Clinic :" after its number was taken
    if (consumed && /^\(?\s*(?:off|office|offlce|work|res|residence|home|mob|mobile|cell|fax|direct|whatsapp|wa|personal|o|m|r)\s*\)?$/i.test(rest)) rest = '';
    return { rest, consumed };
  }

  const MOB_LABEL = /\b(m|mob|mobile|mobil|handy|cell|cellular|cellulare|whatsapp|wa|personal|hp|handphone|hand phone|portable|movil|móvil|gsm|natel|celular)\b/;
  const TEL_LABEL = /\b(t|tel|tél|telephone|téléphone|telefon|telefono|teléfono|fon|off|office|offlce|work|board|landline|ph|phone|direct|dir|d|toll\s*free|o|p|clinic|chamber|hosp|hospital|desk|reception|helpline|customer\s*care|enquiry|sales|support|std)\b/;
  const FAX_LABEL = /\b(fax|telefax|f)\b/;
  const HOME_LABEL = /\b(res|resi|residence|home|h)\b/;
  const METRO_STD = /^0(11|22|33|44|20|40|79|80)/;

  function classifyPhone(context, seg, numRaw, index, after) {
    const c = (context || '').toLowerCase().replace(/[\s.:,\-|()]+$/, '');
    // a label AFTER the number only counts when it is a short parenthesised / bare tag that ends
    // there — "(O)", "(Office)", "(R)" — never the label of the NEXT number ("… 2200  Fax : …")
    const am = /^\s*\(?\s*(off|office|offlce|work|res|resi|residence|home|mob|mobile|cell|fax|direct|whatsapp|wa|personal|o|r|m|w|h)\s*\)?\s*(?:$|[,;|]|(?=\s*$))/i.exec(after || '');
    const a = am ? am[1].toLowerCase() : '';
    // label immediately before or after the number wins
    if (/(^|[\s|])fax$|(^|[\s|])f$/.test(c) || a === 'fax') return 'fax';
    if (new RegExp('(^|[\\s|,])' + MOB_LABEL.source.slice(2) + '$').test(c) || /^(mob|mobile|cell|whatsapp|wa|personal|m)$/.test(a)) return 'mobile';
    if (new RegExp('(^|[\\s|,])' + HOME_LABEL.source.slice(2) + '$').test(c) || /^(res|resi|residence|home|r|h)$/.test(a)) return 'home-phone';
    if (new RegExp('(^|[\\s|,])' + TEL_LABEL.source.slice(2) + '$').test(c) || /^(off|office|offlce|work|direct|o|w)$/.test(a)) return 'work-phone';

    // words elsewhere in this segment
    const l = (seg || '').toLowerCase();
    const hasFax = /\bfax\b/.test(l), hasMob = MOB_LABEL.test(l.replace(/\bm\b/g, 'mob')),
      hasTel = /\b(tel|off|office|offlce|work|board|landline|toll|clinic|hospital|desk|reception|helpline|phone|ph)\b/.test(l), hasHome = /\b(res|residence|home)\b/.test(l);
    const kinds = [hasFax, hasMob, hasTel, hasHome].filter(Boolean).length;
    if (kinds === 1) return hasFax ? 'fax' : hasMob ? 'mobile' : hasHome ? 'home-phone' : 'work-phone';

    const d = digits(numRaw);
    const trimmed = numRaw.trim();
    // toll-free
    if (/^(1800|1860|1[- ]?800|1[- ]?860)/.test(d)) return 'work-phone';
    // Indian metro landline written as "080 4112 6677" / "011-4155 2200": 0 + 2-digit STD + 8 digits
    if (d.length === 11 && METRO_STD.test(d) && /^0\d{2}[\s\-.)]/.test(trimmed)) return 'work-phone';
    if (d.length === 13 && /^91(11|22|33|44|20|40|79|80)/.test(d)) return 'work-phone';
    // Indian mobile: 10 digits starting 6-9, optionally 91 / 0 prefix
    const last10 = d.slice(-10);
    if (last10.length === 10 && /^[6-9]/.test(last10) && (d.length === 10 || (d.length === 12 && d.startsWith('91')) || (d.length === 11 && d.startsWith('0')))) return 'mobile';
    // Indian landline: 0 + STD (2-4 digits) + 6-8 digits, total 10-11 digits starting with 0
    if (/^0\d{9,10}$/.test(d) && !/^0[6-9]\d{9}$/.test(d)) return 'work-phone';
    if (/^91[1-5]\d{9}$/.test(d)) return 'work-phone';
    // German / European mobiles: 015x/016x/017x, +49 15x/16x/17x, +33 6/7, +44 7, +39 3
    if (/^0?1[567]\d{8,9}$/.test(d) || /^491[567]\d{8,9}$/.test(d) || /^33[67]\d{8}$/.test(d) || /^447\d{9}$/.test(d) || /^393\d{8,9}$/.test(d)) return 'mobile';
    // UAE / GCC mobiles
    if (/^(971|966|974|968|965|973)5\d{7,8}$/.test(d) || /^05\d{7,8}$/.test(d)) return 'mobile';
    // international mobile guess: leading + and 11-13 digits
    if (trimmed.startsWith('+') && d.length >= 11) return index === 0 ? 'mobile' : 'work-phone';
    // North-American style: first number on the card → mobile, later ones → work
    if (d.length === 10 || (d.length === 11 && d.startsWith('1'))) return index === 0 ? 'mobile' : 'work-phone';
    return 'work-phone';
  }

  function cleanPhone(numRaw) {
    let s = numRaw.replace(/[—–]/g, '-').replace(/[^\d+()\-.\s]/g, '').trim();
    s = s.replace(/\s{2,}/g, ' ').replace(/^\(?\+?\s*/, m => m.replace(/\s+/g, ''));
    s = s.replace(/^\+\s*/, '+');
    // Indian mobile written with a trunk "0": "098410 12345" / "0 98410 12345" → "98410 12345"
    // (never for landline formatting like "080 4112 6677" / "0731-4046 890")
    if (/^0\s?[6-9]\d{4}[\s\-]?\d{5}$/.test(s)) s = s.replace(/^0\s*/, '');
    return s;
  }

  /* ================= address ================= */

  const US_STATES = {
    al: 'AL', ak: 'AK', az: 'AZ', ar: 'AR', ca: 'CA', co: 'CO', ct: 'CT', de: 'DE', fl: 'FL', ga: 'GA', hi: 'HI', id: 'ID', il: 'IL', in: 'IN',
    ia: 'IA', ks: 'KS', ky: 'KY', la: 'LA', me: 'ME', md: 'MD', ma: 'MA', mi: 'MI', mn: 'MN', ms: 'MS', mo: 'MO', mt: 'MT', ne: 'NE', nv: 'NV',
    nh: 'NH', nj: 'NJ', nm: 'NM', ny: 'NY', nc: 'NC', nd: 'ND', oh: 'OH', ok: 'OK', or: 'OR', pa: 'PA', ri: 'RI', sc: 'SC', sd: 'SD', tn: 'TN',
    tx: 'TX', ut: 'UT', vt: 'VT', va: 'VA', wa: 'WA', wv: 'WV', wi: 'WI', wy: 'WY', dc: 'DC',
    california: 'CA', texas: 'TX', florida: 'FL', 'new york': 'NY', illinois: 'IL', pennsylvania: 'PA', ohio: 'OH', georgia: 'GA', michigan: 'MI',
    'new jersey': 'NJ', virginia: 'VA', washington: 'WA', arizona: 'AZ', massachusetts: 'MA', tennessee: 'TN', indiana: 'IN', maryland: 'MD',
    missouri: 'MO', wisconsin: 'WI', colorado: 'CO', minnesota: 'MN', 'south carolina': 'SC', alabama: 'AL', louisiana: 'LA', kentucky: 'KY',
    oregon: 'OR', oklahoma: 'OK', connecticut: 'CT', utah: 'UT', nevada: 'NV', iowa: 'IA', arkansas: 'AR', mississippi: 'MS', kansas: 'KS',
    'new mexico': 'NM', nebraska: 'NE', idaho: 'ID', hawaii: 'HI', maine: 'ME', montana: 'MT', delaware: 'DE', 'north carolina': 'NC',
    'north dakota': 'ND', 'south dakota': 'SD', vermont: 'VT', wyoming: 'WY', alaska: 'AK', 'west virginia': 'WV', 'rhode island': 'RI', 'new hampshire': 'NH'
  };
  // "San Francisco, CA 94104" / "New York, NY 10005-1402" / "Chicago, IL 60612"
  const US_CITY_STATE_ZIP = /^(.*?),?\s*([A-Za-z .]{3,40}?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/;

  function looksLikeAddress(text) {
    if (ADDR_LABEL.test(text) || (wordsOf(text).length <= 4 && ADDR_LABEL.test(text + ' :'))) return true;
    if (TAGLINE_RE.test(text) || TIMING_RE.test(text)) return false;
    // company / people lines that merely contain "works", "office" etc. are not addresses
    if ((COMPANY_STRONG.test(text) || COMPANY_WEAK.test(text)) && !/\d/.test(text) && !/,/.test(text) &&
        !/\b(road|street|nagar|marg|sector|near|opp\.?|behind|floor|plot|shop|bazaa?r|market|colony)\b/i.test(text)) return false;
    if (US_CITY_STATE_ZIP.test(text)) return true;
    // European: "D-73430 Aalen", "Industriestraße 14", "12 rue de Rivoli", "Calle Mayor 5"
    // (postcode must start the segment or follow a comma, and the segment must not be a phone line)
    if (/(?:^|,\s*)(?:[A-Z]{1,2}-)?\d{4,5}\s+\p{Lu}\p{L}{2,}/u.test(text) && !/\d{6}/.test(text) && !/\d[\d\s\-().]{6,}\d/.test(text) &&
        !/\b(fax|tel|ext|extn|certified|company|ltd|pvt)\b/i.test(text) && !TITLE_RE.test(text) && !COMPANY_STRONG.test(text)) return true;
    if (/\b\p{L}+(?:straße|strasse|straBe|str\.|weg|platz|allee|gasse|ring|damm|ufer|laan|straat|plein|gracht|vej|gatan|gata)\b\s*\d/iu.test(text)) return true;
    if (/\b(rue|avenue|boulevard|bd|chemin|place|impasse|calle|avenida|carrera|via|viale|piazza|corso|strada|ulica|ul\.)\b/i.test(text) && /\d/.test(text)) return true;
    const hasPin = RE_PIN_IN.test(text) || RE_ZIP_US.test(text) || RE_POSTCODE_UK.test(text);
    const hasWord = ADDR_WORDS.test(text);
    const hasState = IN_STATE_RE.test(text) || IN_STATE_ABBR_RE.test(text);
    const hasCity = wordsOf(text.toLowerCase().replace(/[^a-z\s]/g, ' ')).some(w => w.length > 3 && CITIES.has(w));
    const hasCountry = COUNTRIES.test(text);
    if (hasPin) {
      if (hasWord || hasState || hasCity || hasCountry || /,/.test(text)) return true;
      // "Noida - 201301" — word before PIN
      return /[A-Za-z]{3,}\s*[-–,]?\s*\d{6}\b/.test(text) || /\bpin\b/i.test(text);
    }
    if (hasWord) {
      const commas = (text.match(/,/g) || []).length;
      const digitCount = digits(text).length;
      const strong = /\b(road|rd\.?|street|st\.?|marg|nagar|sector|phase|plot|floor|shop|gali|near|nr\.?|opp\.?|opposite|behind|colony|enclave|vihar|puram|layout|complex|tower|towers|building|bldg|apartment|society|market|bazaa?r|chowk|industrial|estate|p\.?\s?o\.?\s?box|po\s*box|distt\.?|dist\.?|tehsil|taluka|village|vill\.?|highway|bypass|junction|station|cross|stage|extension|extn|house|h\.?\s?no\.?|flat|km\s*stone|milestone|godown|showroom)\b/i.test(text);
      return commas >= 1 || digitCount >= 1 || strong;
    }
    if ((hasState || hasCity) && (/,/.test(text) || hasCountry || /[-–]\s*\d/.test(text))) return true;
    if (hasCity && hasState) return true;
    if (hasCountry && /,/.test(text)) return true;
    // "Mumbai - 400 002" style with spaced pin
    if (/[A-Za-z]{3,}\s*[-–]\s*\d{3}\s?\d{3}\b/.test(text)) return true;
    return false;
  }

  const EU_COUNTRY = { D: 'Germany', A: 'Austria', CH: 'Switzerland', F: 'France', I: 'Italy', NL: 'Netherlands', B: 'Belgium', E: 'Spain', P: 'Portugal', DK: 'Denmark', S: 'Sweden', N: 'Norway', PL: 'Poland', CZ: 'Czech Republic', L: 'Luxembourg' };
  // "D-73430 Aalen" / "73430 Aalen" / "75008 Paris" (postcode BEFORE city)
  const EU_ZIP_CITY = /(?:^|[\s,])(?:([A-Z]{1,2})-)?(\d{4,5})\s+(\p{Lu}[\p{L}.'-]+(?:\s+\p{Lu}[\p{L}.'-]+){0,2})(?=\s*[-–,]|\s*$)/u;

  function structureAddress(joined) {
    const out = { street: '', city: '', state: '', zip: '', country: '' };
    let rest = ' ' + joined.replace(/\s+/g, ' ').replace(/\s[Il|]\s/g, ', ') + ' ';   // OCR'd pipes "Mumbai I Maharashtra"
    rest = rest.replace(ADDR_LABEL, ' ');

    // European "PLZ City" style (only when there is no Indian 6-digit PIN)
    if (!/\b\d{3}\s?\d{3}\b/.test(rest) && !US_CITY_STATE_ZIP.test(rest.trim())) {
      const eu = EU_ZIP_CITY.exec(rest);
      if (eu && !/\b(road|street|nagar|marg|sector|floor|plot|shop|near|opp)\b/i.test(eu[3])) {
        out.zip = eu[2];
        out.city = eu[3].trim();
        const cm0 = COUNTRIES.exec(rest);
        out.country = cm0 ? canonicalCountry(cm0[0]) : (EU_COUNTRY[eu[1]] || '');
        let street = rest.replace(eu[0], ' ');
        if (cm0) street = street.replace(cm0[0], ' ');
        out.street = street.split(/[,;]/).map(s => s.replace(/^[\s\-–]+|[\s\-–]+$/g, '')).filter(Boolean).join(', ');
        return out;
      }
    }

    // US / Canada style "…, City, ST 12345[-6789]"
    const us = US_CITY_STATE_ZIP.exec(rest.trim());
    if (us && US_STATES[us[3].toLowerCase()]) {
      out.street = us[1].replace(/[,\s]+$/, '').trim();
      out.city = us[2].trim().replace(/\b([a-z])/g, m => m.toUpperCase());
      out.state = US_STATES[us[3].toLowerCase()];
      out.zip = us[4];
      out.country = 'USA';
      return out;
    }

    // zip
    let pin = /\b(\d{3})\s?(\d{3})\b(?!\s*\d)/.exec(rest);
    if (pin) { out.zip = pin[1] + pin[2]; rest = rest.replace(pin[0], ' '); }
    else {
      const z = RE_ZIP_US.exec(rest) || RE_POSTCODE_UK.exec(rest);
      if (z) { out.zip = z[0]; rest = rest.replace(z[0], ' '); }
    }
    rest = rest.replace(/\b(pin\s*code|pincode|pin|zip|postal\s*code|post\s*code)\s*[:.\-–]?\s*/gi, ' ');

    // country
    const cm = COUNTRIES.exec(rest);
    if (cm) { out.country = canonicalCountry(cm[0]); rest = rest.replace(cm[0], ' '); }

    // state (India) — full names first, then abbreviations "(M.P.)" / ", TN"
    let sm = IN_STATE_RE.exec(rest);
    if (sm) {
      out.state = IN_STATES[sm[1].toLowerCase()];
      // Delhi is both city and state: keep the words for city detection
      if (!/^(delhi|new delhi)$/i.test(sm[1])) rest = rest.replace(sm[0], ' ');
    } else {
      const ab = /[(,\s]\s*(A\.?P\.?|C\.?G\.?|G\.?J\.?|H\.?R\.?|H\.?P\.?|K\.?A\.?|K\.?L\.?|M\.?P\.?|M\.?H\.?|P\.?B\.?|R\.?J\.?|T\.?N\.?|T\.?S\.?|U\.?P\.?|W\.?B\.?|U\.?K\.?)\s*[),]?(?=\s|$)/.exec(rest);
      if (ab) {
        const key = ab[1].toLowerCase().replace(/\./g, '');
        if (IN_STATES[key] && (out.zip || /[(,]/.test(ab[0]))) { out.state = IN_STATES[key]; rest = rest.replace(ab[0], ' '); }
      }
    }
    if (out.state && !out.country) out.country = 'India';
    if (!out.country && out.zip && /^\d{6}$/.test(out.zip)) out.country = 'India';

    // city: known city word, preferring the last one (address order is street→city→state)
    const chunks = rest.split(/[,;()]/).map(s => s.replace(/^[\s\-–.]+|[\s\-–.]+$/g, '')).filter(Boolean);
    let cityIdx = -1, city = '';
    for (let i = chunks.length - 1; i >= 0; i--) {
      const c = chunks[i];
      const key = squash(c);
      const ws = wordsOf(c.toLowerCase().replace(/[^a-z\s]/g, ' '));
      if (CITIES.has(key) || (ws.length <= 3 && ws.some(w => w.length > 3 && CITIES.has(w)) && ws.length <= 3 && !ADDR_WORDS.test(c))) {
        city = c.replace(/\s*[-–]\s*$/, ''); cityIdx = i; break;
      }
      // "Gurgaon" from "Gurgaon 122001" already stripped; last chunk that is 1-2 capitalised words with no address word
      if (i === chunks.length - 1 && /^[A-Za-z .]+$/.test(c) && ws.length <= 2 && !ADDR_WORDS.test(c) && !TITLE_RE.test(c) && c.length >= 3) { city = c; cityIdx = i; }
    }
    if (!city) {
      // word(s) immediately before the PIN in the original string
      const m = /([A-Za-z][A-Za-z .]{2,30}?)\s*[-–,:]?\s*\d{3}\s?\d{3}\b/.exec(joined);
      if (m) {
        const cand = m[1].trim().split(/[,()]/).pop().trim();
        const ws = wordsOf(cand);
        if (ws.length <= 3 && !ADDR_WORDS.test(cand)) city = ws.slice(-2).join(' ');
      }
    }
    if (city) {
      city = city.replace(/\b(dist|distt|district|tehsil|taluka|tal)\b\.?/i, '').replace(/[\s\-–.,]+$/g, '').replace(/\s+/g, ' ').trim();
      // Title Case
      city = city.replace(/\b([a-z])/g, m => m.toUpperCase());
      if (/^(new )?delhi$/i.test(city) && !out.state) out.state = 'Delhi';
      out.city = city;
      if (cityIdx >= 0) chunks.splice(cityIdx, 1);
    }
    out.street = chunks.join(', ').replace(/\s+,/g, ',').replace(/,\s*,/g, ',').replace(/^[,\s]+|[,\s]+$/g, '').replace(/\s+/g, ' ');
    return out;
  }

  function canonicalCountry(c) {
    const k = c.toLowerCase().replace(/\./g, '');
    if (/^(usa|united states)$/.test(k)) return 'USA';
    if (/^(uk|united kingdom|england)$/.test(k)) return 'United Kingdom';
    if (/^(uae|united arab emirates)$/.test(k)) return 'UAE';
    if (/^(ksa|saudi arabia)$/.test(k)) return 'Saudi Arabia';
    return c.replace(/\b\w/g, m => m.toUpperCase());
  }

  /* ================= scoring ================= */

  function scoreName(seg, ctxLine, layout) {
    const raw = seg.text;
    let t = raw.replace(/[,.]+$/, '').trim();
    if (!nameShape(t)) return -99;
    const sp = stripPrefixes(splitNameDegrees(t).name);
    const hasPrefix = sp.prefixes.some(p => !/^prop/i.test(p));
    const isProp = sp.prefixes.some(p => /^prop/i.test(p));
    const core = sp.core.replace(/\s*[\(\[].*?[\)\]]\s*$/, '').trim();
    const ws = wordsOf(core);
    if (!ws.length) return -99;
    let s = 0;
    if (!hasLatin(core)) return -99;
    if (hasPrefix || isProp) s += 3.5;
    const lw = ws.map(w => w.toLowerCase().replace(/[^a-z']/g, ''));
    if (FIRST_NAMES.has(lw[0])) s += 3;
    if (lw.slice(1).some(w => SURNAMES.has(w))) s += 2.5;
    else if (SURNAMES.has(lw[0]) && lw.length >= 2) s += 1;
    if (lw.length === 1 && !FIRST_NAMES.has(lw[0]) && !hasPrefix) s -= 2;
    if (ws.length >= 2 && ws.length <= 3) s += 1;
    if (ws.every(isTitleWord)) s += 0.75;
    if (layout.relH >= 1.25) s += 1.5; else if (layout.relH >= 1.05) s += 0.75;
    if (layout.pos <= 0.4) s += 0.75;
    if (layout.nearTitle) s += 2;
    if (layout.nearDegrees) s += 1.5;
    // negatives
    if (TITLE_STRONG.test(core)) s -= 5;
    else if (TITLE_RE.test(core) && !hasPrefix) s -= 2;
    if (COMPANY_STRONG.test(core)) return -99;                    // "Sharma & Sons" is never a person
    if (COMPANY_WEAK.test(core)) {
      // "John Mills" / "Priya Stone": a known first name + a surname that happens to be an industry word
      const surnameLast = SURNAMES.has(lw[lw.length - 1]) && FIRST_NAMES.has(lw[0]) && ws.length <= 3;
      if (!surnameLast) return -99;                               // "Sri Murugan Agencies", "Gupta Enterprises"
      s -= 1.5;
    }
    if (FUNCTION_WORDS.test(core.toLowerCase()) && ws.length >= 3) s -= 4;
    if ((core.match(/\./g) || []).length >= 2 && !/^[A-Z]\.\s?[A-Z]\./.test(core)) s -= 3;   // "Build. Ship. Repeat."
    if (TAGLINE_RE.test(core)) s -= 5;
    if (layout.domainMatch) s -= 4;
    if (/\b(since|estd?)\b/i.test(core)) s -= 5;
    if (IN_STATE_RE.test(core) || (CITIES.has(squash(core)) && !FIRST_NAMES.has(lw[0]))) s -= 4;
    if (ws.length === 1 && isCapsWord(ws[0]) && !FIRST_NAMES.has(lw[0])) s -= 2;
    return s;
  }

  function scoreCompany(seg, layout) {
    const t = seg.text.trim();
    if (t.length < 2) return -99;
    if (/@|www\.|https?:/.test(t)) return -99;
    let s = 0;
    if (!hasLatin(t)) s -= 4;                       // prefer the Latin-script brand line
    if (layout.prefixOfLonger) s -= 2.5;            // "SARASWATI" when "SARASWATI MARBLES & GRANITES" also exists
    if (layout.extendsShorter) s += 2;
    const strong = COMPANY_STRONG.test(t);
    if (strong) s += 6;
    const weak = COMPANY_WEAK.test(t);
    const titleLike = TITLE_STRONG.test(t) || (TITLE_RE.test(t) && wordsOf(t).length <= 5 && !weak);
    if (weak && !titleLike) s += 3;
    if (layout.domainMatch) s += 4.5;
    if (layout.relH >= 1.4) s += 2.5; else if (layout.relH >= 1.15) s += 1.25;
    if (layout.isLargest) s += 1;
    const ws = wordsOf(t);
    const caps = ws.length && ws.every(w => isCapsWord(w) || /^[&\-.,'’]+$/.test(w) || /^\d+$/.test(w));
    if (caps && t.replace(/[^A-Z]/g, '').length >= 4) s += 1.5;
    if (/[&]|\band\b/i.test(t) && ws.length <= 6) s += 0.75;
    if (layout.pos <= 0.2 || layout.pos >= 0.85) s += 0.5;
    if (layout.page > 0 && layout.pos <= 0.3) s += 0.5;
    // negatives
    if (titleLike && !strong) s -= 4;
    if (TAGLINE_RE.test(t)) s -= 5;
    if (FUNCTION_WORDS.test(t.toLowerCase()) && ws.length >= 4 && !strong) s -= 3;
    if (/[.!?]$/.test(t) && (t.match(/[.!?]/g) || []).length >= 2) s -= 4;
    if (/\d{5,}/.test(t)) s -= 4;
    // "Mr. X" is a person — but "Sri Balaji Traders", "Dr. Reddy's Laboratories", "Shri Ram Steels" are companies
    if (NAME_PREFIX.test(t) && !strong && !weak && !/^(sri|shri|sree|shree|om|jai|jay|new|the)\b/i.test(t) && !/'s\b/i.test(t)) s -= 5;
    if (DEGREES.test(t) && !strong && !weak) s -= 3;
    if (ID_LABEL.test(t)) s -= 6;
    if (looksLikeAddress(t) && !strong) s -= 3;
    if (IN_STATE_RE.test(t) && ws.length <= 3 && !strong && !weak) s -= 5;
    // person-name likeness
    const lw = ws.map(w => w.toLowerCase().replace(/[^a-z']/g, ''));
    if (!strong && !weak && ws.length >= 2 && ws.length <= 3 && FIRST_NAMES.has(lw[0]) && lw.slice(1).some(w => SURNAMES.has(w))) s -= 4;
    if (!strong && !weak && layout.nearTitle && nameShape(t)) s -= 1.5;
    if (ws.length > 8) s -= 2;
    return s;
  }

  function scoreTitle(seg, layout) {
    const t = seg.text.trim().replace(/^\(|\)$/g, '');
    if (!TITLE_RE.test(t)) return -99;
    if (COMPANY_STRONG.test(t)) return -99;
    if (/@|www\.|\d{4,}/.test(t)) return -99;
    if (/^prop\.?\s+\S/i.test(t) && nameShape(t)) return -99;      // "Prop. Ramesh Chand" is a name line
    if (!/[A-Za-z]/.test(t)) return -99;
    const ws = wordsOf(t);
    if (ws.length > 9) return -99;
    let s = 1;
    if (TITLE_STRONG.test(t)) s += 3;
    if (ws.length <= 5) s += 1;
    if (layout.relH <= 1.1) s += 0.5;
    if (COMPANY_WEAK.test(t) && !TITLE_STRONG.test(t)) s -= 2.5;
    if (nameShape(t) && wordsOf(t).every(w => FIRST_NAMES.has(w.toLowerCase()) || SURNAMES.has(w.toLowerCase()))) s -= 4;
    if (TAGLINE_RE.test(t)) s -= 4;
    if (looksLikeAddress(t)) s -= 3;
    if (FUNCTION_WORDS.test(t.toLowerCase()) && ws.length >= 4 && !TITLE_STRONG.test(t)) s -= 2;
    return s;
  }

  const hasLatin = t => /[A-Za-z]{2,}/.test(t);

  const DEPT_RE = /\b(dept\.?|department|division|div\.?|wing|cell|desk|team|unit|vertical|practice)\b/i;

  /* ================= main parse ================= */

  /**
   * @param {{text:string, lines:Array<{text,confidence,height,bbox,page?,pos?}>}} ocr
   * @returns {{fields:Array<{category,value,confidence,data?}>, unassigned:string[]}}
   */
  function parse(ocr) {
    const fields = [];
    const unassigned = [];
    const seen = { emails: new Set(), phones: new Set(), urls: new Set(), ids: new Set() };

    // ---------- lines ----------
    let raw = (ocr.lines && ocr.lines.length)
      ? ocr.lines.map((l, i) => ({ ...l, idx: i }))
      : (ocr.text || '').split(/\n+/).map((t, i, arr) => ({ text: t.trim(), confidence: 80, height: 1, page: 0, pos: arr.length > 1 ? i / (arr.length - 1) : 0, bbox: { y0: i * 10 }, idx: i }));

    // per-page position if not provided
    const byPage = {};
    raw.forEach(l => { l.page = l.page || 0; (byPage[l.page] = byPage[l.page] || []).push(l); });
    Object.values(byPage).forEach(list => list.forEach((l, i) => { if (l.pos == null) l.pos = list.length > 1 ? i / (list.length - 1) : 0; }));

    const lines = raw
      .map(l => ({ ...l, text: cleanLine(l.text) }))
      .filter(l => l.text.length >= 2 && !isGarbage(l.text, l.confidence == null ? 80 : l.confidence));

    const heights = lines.map(l => l.height || 1).filter(h => h > 1);
    const medianH = median(heights) || 1;
    const maxH = Math.max(...heights, 1);
    const emailDomains = new Set();

    // ---------- segments + structured extraction ----------
    const segs = [];   // residual text segments with layout
    const ctx = { fields, seen, line: '', phoneIndex: 0 };
    for (const line of lines) {
      ctx.line = line.text;
      const parts = segmentLine(line.text);
      for (const part of parts) {
        const { rest } = extractStructured(part.text, ctx);
        if (!rest) continue;
        if (rest.replace(/[^\p{L}]/gu, '').length < 2) continue;
        // drop leftover pure labels / single letters
        if (/^[A-Za-z]$/.test(rest) || LABEL_JUNK.test(rest + ':')) continue;
        segs.push({
          text: rest, line, page: line.page, pos: line.pos, idx: line.idx, fromEmDash: part.emRight, twoCol: part.twoCol,
          relH: (line.height || 1) / medianH, isLargest: (line.height || 1) >= maxH * 0.95
        });
      }
    }
    seen.emails.forEach(e => emailDomains.add(e.split('@')[1]));
    const domainLabels = new Set();
    [...emailDomains, ...[...seen.urls].map(hostOf)].forEach(d => {
      if (!d || FREE_MAIL.test(d)) return;
      const label = d.replace(/^www\./, '').split('.')[0];
      if (label.length >= 4) domainLabels.add(label.toLowerCase());
    });
    const domainMatch = t => {
      const q = squash(t);
      if (q.length < 4) return false;
      for (const dl of domainLabels) {
        if (q === dl || q.replace(/(pvtltd|privatelimited|ltd|limited|llp|llc|inc|corp|corporation|company|co)$/, '') === dl) return true;
        if (dl.length >= 5 && (q.includes(dl) || dl.includes(q)) && Math.min(q.length, dl.length) >= 5) return true;
      }
      return false;
    };

    // ---------- classify residual segments ----------
    const addrSegs = [], noteSegs = [], degreeSegs = [], deptSegs = [];
    const candidates = [];

    const STRONG_DEGREE = /\b(m\.?b\.?b\.?s|b\.?d\.?s|b\.?a\.?m\.?s|b\.?h\.?m\.?s|d\.?n\.?b|m\.?ch|f\.?r\.?c\.?s|m\.?r\.?c\.?p|ph\.?\s?d|m\.?b\.?a|b\.?tech|m\.?tech|b\.?sc|m\.?sc|b\.?com|m\.?com|ll\.?b|ll\.?m|f\.?c\.?a|a\.?c\.?a|c\.?m\.?a|i\.?c\.?w\.?a|c\.?f\.?a|c\.?p\.?a|b\.?arch|m\.?arch|b\.?pharm|m\.?pharm|d\.?pharm|p\.?g\.?d\.?m|b\.?c\.?a|m\.?c\.?a|m\.?d\.?s|d\.?c\.?h|d\.?g\.?o|d\.?ortho|m\.?phil|b\.?ed|m\.?ed|dipl\.?-?ing|fellow|gold medalist|hons)\b/i;
    for (const s of segs) {
      const t = s.text;
      if (looksLikeAddress(t) && !COMPANY_STRONG.test(t)) { addrSegs.push(s); continue; }
      if (TAGLINE_RE.test(t) || TIMING_RE.test(t)) { noteSegs.push(s); continue; }
      // qualifications line: mostly degrees ("MBBS, MD (Medicine), FICP", "B.Sc (Agri), MBA") — but not a
      // person line that merely ends in degrees ("CA Sunita Raghavan, B.Com, FCA")
      const degTokens = t.split(/[,\s()]+/).filter(Boolean);
      const degHits = degTokens.filter(w => DEGREES.test(w)).length;
      const strong = STRONG_DEGREE.test(t) || MEDICAL_DEGREE.test(t);
      const personWithDegrees = (() => {
        const sd = splitNameDegrees(t.replace(/[,.]+$/, '').trim());
        if (!sd.degrees) return false;
        const core = wordsOf(stripPrefixes(sd.name).core);
        return core.length >= 2 && core.every(w => isTitleWord(w) || isCapsWord(w)) && !DEGREES.test(core.join(' '));
      })();
      if (strong && !personWithDegrees && !TITLE_STRONG.test(t) && !/^prop/i.test(t) &&
          (degHits >= Math.max(1, Math.ceil(degTokens.length / 2) - 1) || (degTokens.length <= 6 && /^[A-Z][A-Za-z.]*(?:\s*[,(].*)?$/.test(t) && !nameShape(t)))) {
        degreeSegs.push(s); continue;
      }
      candidates.push(s);
    }

    // layout hints
    const titleIdx = new Set(), degIdx = new Set(degreeSegs.map(d => d.page + ':' + d.idx));
    candidates.forEach(c => { c.domainMatch = domainMatch(c.text); });
    // logo lock-ups: "SARASWATI" + "SARASWATI MARBLES & GRANITES" — the longer line is the real name
    candidates.forEach(c => {
      const q = squash(c.text);
      if (q.length < 4) return;
      candidates.forEach(o => {
        if (o === c) return;
        const oq = squash(o.text);
        if (oq.length > q.length + 3 && oq.startsWith(q)) { c.prefixOfLonger = true; o.extendsShorter = true; }
      });
    });
    candidates.forEach(c => { if (scoreTitle(c, c) > 1.5) titleIdx.add(c.page + ':' + c.idx); });
    candidates.forEach(c => {
      c.nearTitle = [...titleIdx].some(k => { const [p, i] = k.split(':').map(Number); return p === c.page && Math.abs(i - c.idx) === 1; });
      c.nearDegrees = [...degIdx].some(k => { const [p, i] = k.split(':').map(Number); return p === c.page && Math.abs(i - c.idx) <= 1; });
    });

    const scored = candidates.map(c => ({
      seg: c,
      name: scoreName(c, c.line, c),
      company: scoreCompany(c, c),
      title: scoreTitle(c, c)
    }));

    // ---- title(s) ----
    // A title candidate must not be a better name/company; prefer strong designations.
    const titleCands = scored
      .filter(x => x.title >= 1.5 && !(x.name > x.title + 1 && x.name >= 3) && !(x.company > x.title + 1.5 && x.company >= 4))
      .sort((a, b) => (b.title - a.title) || (a.seg.page - b.seg.page) || (a.seg.idx - b.seg.idx));
    let titleField = null, deptField = null;
    const used = new Set();
    if (titleCands.length) {
      // among equally strong candidates take the earliest on the card (first person on a two-person card)
      const topScore = titleCands[0].title;
      const top = titleCands.filter(x => x.title >= topScore - 0.5).sort((a, b) => (a.seg.page - b.seg.page) || (a.seg.idx - b.seg.idx))[0];
      used.add(top.seg);
      let val = cleanupTitle(top.seg.text);
      titleField = { category: 'title', value: val, confidence: top.title >= 4 ? 'high' : 'medium' };
      // "Founder • CEO" split from the SAME line → rejoin; a different strong designation on the
      // adjacent line (not a two-person card) → append once
      const sameLine = titleCands.filter(x => x !== top && !top.seg.twoCol && x.seg.page === top.seg.page && x.seg.idx === top.seg.idx && x.title >= 2.5 && squash(x.seg.text) !== squash(top.seg.text));
      sameLine.slice(0, 2).forEach(x => { used.add(x.seg); titleField.value += ' & ' + cleanupTitle(x.seg.text); });
      const second = !sameLine.length && titleCands.find(x => x !== top && x.title >= 4 && x.seg.page === top.seg.page && Math.abs(x.seg.idx - top.seg.idx) === 1 &&
        squash(x.seg.text) !== squash(top.seg.text) && !DEPT_RE.test(x.seg.text) && wordsOf(x.seg.text).length <= 4);
      if (second && !/\b(partner|proprietor|director|founder|ceo)\b/i.test(top.seg.text)) {
        used.add(second.seg);
        titleField.value += ', ' + cleanupTitle(second.seg.text);
      }
      // duplicates of the title elsewhere (two people, both "Partner") are consumed silently
      titleCands.forEach(x => { if (x !== top && squash(x.seg.text) === squash(top.seg.text)) used.add(x.seg); });
    }
    // department: explicit dept words, or the short right-hand part of a "Title — Dept" split
    for (const s of segs) {
      if (deptField) break;
      if (used.has(s) || addrSegs.includes(s) || noteSegs.includes(s)) continue;
      const t = s.text;
      if (DEPT_RE.test(t) && wordsOf(t).length <= 6 && !COMPANY_STRONG.test(t) && !looksLikeAddress(t) && !nameShape(t)) {
        deptField = { category: 'department', value: t.replace(/\s*(dept\.?|department|division|div\.?)\s*$/i, '').replace(/^\s*(dept\.?|department)\s+of\s+/i, '').trim(), confidence: 'medium' };
        used.add(s);
      } else if (s.fromEmDash && wordsOf(t).length <= 4 && !TITLE_STRONG.test(t)) {
        deptField = { category: 'department', value: t.trim(), confidence: 'medium' };
        used.add(s);
      }
    }

    // ---- name vs company (joint assignment) ----
    let nameField = null, companyField = null;
    const pool = scored.filter(x => !used.has(x.seg));
    const bestName = pool.filter(x => x.name > 0).sort((a, b) => b.name - a.name);
    const bestComp = pool.filter(x => x.company > 0).sort((a, b) => b.company - a.company);

    let nPick = bestName[0] || null, cPick = bestComp[0] || null;
    if (nPick && cPick && nPick.seg === cPick.seg) {
      // conflict: which role does this line fit better, considering runner-ups?
      const nAlt = bestName[1], cAlt = bestComp[1];
      const nMargin = nPick.name - (nAlt ? nAlt.name : -2);
      const cMargin = cPick.company - (cAlt ? cAlt.company : -2);
      if (nPick.name - cPick.company > 0.5 || (Math.abs(nPick.name - cPick.company) <= 0.5 && nMargin >= cMargin)) cPick = cAlt || null;
      else nPick = nAlt || null;
    }
    if (nPick && nPick.name >= 2) {
      used.add(nPick.seg);
      let val = nPick.seg.text.replace(/[,.]+$/, '').trim();
      // strip degrees appended to the name: "Adv. Rajendra K. Bhargava, B.Sc., LL.B."
      const sd = splitNameDegrees(val);
      if (sd.degrees) { val = sd.name; degreeSegs.push({ text: sd.degrees }); }
      val = val.replace(/\s*[\(\[].*?[\)\]]\s*$/, '').trim();
      if (/^prop\b/i.test(val)) {
        val = val.replace(NAME_PREFIX, '').trim();
        if (!titleField) titleField = { category: 'title', value: 'Proprietor', confidence: 'high' };
      }
      // Title-case ALL-CAPS names for nicer output (keep initials like "S." / "A.K.")
      if (/^[A-Z\s.'\-]+$/.test(val)) val = titleCaseName(val);
      nameField = { category: 'name', value: val, confidence: nPick.name >= 5 ? 'high' : nPick.name >= 3 ? 'medium' : 'low' };
    }
    if (cPick && cPick.company >= 2 && cPick.seg !== (nPick && nPick.seg)) {
      used.add(cPick.seg);
      companyField = { category: 'company', value: cPick.seg.text.replace(/[,;:]+$/, '').trim(), confidence: cPick.company >= 6 ? 'high' : cPick.company >= 3.5 ? 'medium' : 'low' };
    }
    // company fallback: largest remaining line, or corporate email domain
    if (!companyField) {
      const rem = pool.filter(x => !used.has(x.seg) && x.company > -2 && x.title < 1.5).sort((a, b) => (b.seg.relH - a.seg.relH));
      const big = rem.find(x => x.seg.relH >= 1.3 && wordsOf(x.seg.text).length <= 6);
      if (big) { used.add(big.seg); companyField = { category: 'company', value: big.seg.text, confidence: 'low' }; }
    }
    if (!companyField && domainLabels.size) {
      const dl = [...domainLabels][0];
      companyField = { category: 'company', value: dl.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), confidence: 'low' };
    }
    // second strong name → unassigned (two people on the card)
    // (kept for review; users can re-assign)

    // ---- website fallback from corporate email ----
    if (![...fields].some(f => f.category === 'website') && emailDomains.size) {
      const corp = [...emailDomains].find(d => !FREE_MAIL.test(d));
      if (corp && !socialFromHost(corp)) fields.push({ category: 'website', value: 'https://www.' + corp, confidence: 'low' });
    }

    // ---- addresses: group consecutive lines (same page, adjacent) ----
    addrSegs.sort((a, b) => (a.page - b.page) || (a.idx - b.idx));
    const groups = [];
    for (const s of addrSegs) {
      const g = groups[groups.length - 1];
      const labeled = ADDR_LABEL.test(s.text);
      if (g && s.page === g.page && s.idx - g.lastIdx <= 2 && !labeled) { g.parts.push(s.text); g.lastIdx = s.idx; }
      else groups.push({ page: s.page, lastIdx: s.idx, parts: [s.text] });
    }
    // merge tiny trailing groups (e.g. "Maharashtra" alone) into the previous group on the same page
    for (let i = groups.length - 1; i > 0; i--) {
      if (groups[i].page === groups[i - 1].page && groups[i].parts.length === 1 && wordsOf(groups[i].parts[0]).length <= 3 && !ADDR_LABEL.test(groups[i].parts[0])) {
        groups[i - 1].parts.push(...groups[i].parts); groups.splice(i, 1);
      }
    }
    groups.slice(0, 2).forEach((g, gi) => {
      const joined = g.parts.map(p => p.replace(/[,;\s]+$/, '')).join(', ').replace(/,\s*,/g, ',');
      const data = structureAddress(joined);
      const labelM = ADDR_LABEL.exec(g.parts[0]);
      if (labelM) data.label = labelM[1].replace(/\s+/g, ' ');
      fields.push({ category: gi === 0 ? 'address' : 'address2', value: joined.replace(ADDR_LABEL, ''), confidence: data.zip || data.city ? 'high' : 'medium', data });
    });

    // ---- degrees / notes ----
    if (degreeSegs.length) {
      const q = degreeSegs.map(d => d.text.replace(/^[,\s]+|[,\s]+$/g, '')).join(', ');
      fields.push({ category: 'notes', value: 'Qualifications: ' + q, confidence: 'medium' });
    }
    noteSegs.forEach(n => fields.push({ category: 'notes', value: n.text, confidence: 'low' }));

    [nameField, titleField, deptField, companyField].forEach(f => { if (f) fields.push(f); });
    fields.sort((a, b) => orderOf(a) - orderOf(b));

    // ---- unassigned ----
    for (const x of scored) {
      if (used.has(x.seg)) continue;
      const t = x.seg.text.trim();
      if (!t || t.length < 3) continue;
      if (fields.some(f => f.value === t)) continue;
      unassigned.push(t);
    }
    return { fields, unassigned };
  }

  function titleCaseName(s) {
    return s.split(' ').map(w => {
      if (/^[A-Z]\.?$/.test(w) || /^(?:[A-Z]\.){2,}$/.test(w)) return w;          // initials
      return w.toLowerCase().replace(/(^|[.'\-])([a-z])/g, (m, p, c) => p + c.toUpperCase());
    }).join(' ').replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase());
  }

  function orderOf(f) {
    const order = ['name', 'title', 'department', 'company', 'mobile', 'work-phone', 'home-phone', 'fax', 'email', 'website', 'social', 'address', 'address2', 'custom', 'notes'];
    const i = order.indexOf(f.category);
    return i === -1 ? 99 : i;
  }

  function cleanupTitle(t) {
    return t.replace(/[|•·]+/g, ' ').replace(/\s+/g, ' ').replace(/^[,\-–\s]+|[,\-–\s]+$/g, '').trim();
  }

  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  /* ================= fields → contact model ================= */

  function fieldsToModel(fields, base) {
    const m = base || FormUI.emptyModel();
    const notes = [];

    for (const f of fields) {
      const v = (f.value || '').trim();
      if (!v || f.category === 'ignore') continue;
      switch (f.category) {
        case 'name': {
          // AI path supplies structured parts
          if (f.data && (f.data.first || f.data.last) && !(m.name.first || m.name.last)) {
            m.name.prefix = f.data.prefix || ''; m.name.first = f.data.first || ''; m.name.middle = f.data.middle || ''; m.name.last = f.data.last || '';
            break;
          }
          const existing = [m.name.prefix, m.name.first, m.name.middle, m.name.last].filter(Boolean).join(' ');
          if (m.name.first || m.name.last) {
            if (squash(existing) !== squash(v)) notes.push('Also on card: ' + v);
            break;
          }
          // stacked / parenthesised honorifics: "Prof. Dr. (Mrs.) Sunita Sharma"
          const sp = stripPrefixes(v.replace(/\s+/g, ' ').trim());
          const prefixes = [];
          sp.prefixes.forEach(raw => {
            if (/^prop/i.test(raw)) { if (!m.work.title) m.work.title = 'Proprietor'; }
            else prefixes.push(NAME_PREFIX_ABBR.test(raw) ? raw.replace(/\.$/, '') + '.' : raw);
          });
          if (prefixes.length) m.name.prefix = prefixes.join(' ');
          let t = sp.core.replace(/\s*[\(\[].*?[\)\]]\s*$/, '').replace(/[,.]+$/, '');
          const parts = t.split(' ').filter(Boolean);
          if (parts.length === 1) m.name.first = parts[0];
          else { m.name.first = parts[0]; m.name.last = parts[parts.length - 1]; m.name.middle = parts.slice(1, -1).join(' '); }
          break;
        }
        case 'title': if (!m.work.title) m.work.title = v; else if (m.work.title !== v) notes.push(v); break;
        case 'department': if (!m.work.department) m.work.department = v; else notes.push('Department: ' + v); break;
        case 'company': if (!m.work.company) m.work.company = v; else if (m.work.company !== v) notes.push('Company: ' + v); break;
        case 'mobile': pushPhone(m, 'mobile', v); break;
        case 'work-phone': pushPhone(m, 'work', v); break;
        case 'home-phone': pushPhone(m, 'home', v); break;
        case 'fax': pushPhone(m, 'work fax', v); break;
        case 'email': {
          if (!m.emails.some(e => e.address.toLowerCase() === v.toLowerCase())) {
            const free = FREE_MAIL.test(v.split('@')[1] || '');
            m.emails.push({ type: free && m.emails.length ? 'home' : (m.emails.length ? 'other' : (free ? 'home' : 'work')), address: v });
          }
          break;
        }
        case 'website': {
          const u = normUrl(v);
          if (!m.work.websites.includes(u)) m.work.websites.push(u);
          break;
        }
        case 'social': {
          const net = (f.data && f.data.network) || socialFromHost(hostOf(v)) || 'custom';
          const u = normUrl(v);
          if (!m.social.some(s => s.url === u)) m.social.push({ network: net, url: u, label: net === 'custom' ? 'Profile' : undefined });
          break;
        }
        case 'address': case 'address2': {
          const a = f.data && f.data.street !== undefined ? f.data : structureAddress(v);
          const isHome = a.label && /^\s*(res|resi|residence|home)\b/i.test(a.label);
          const type = isHome ? 'home' : (f.category === 'address' ? 'work' : 'other');
          if (a.street || a.city || a.zip) {
            const key = squash((a.street || '') + (a.city || '') + (a.zip || ''));
            if (!m.addresses.some(x => squash((x.street || '') + (x.city || '') + (x.zip || '')) === key)) {
              m.addresses.push({ type, po: '', ext: '', street: a.street || (a.city ? '' : v), city: a.city || '', state: a.state || '', zip: a.zip || '', country: a.country || '' });
            }
          }
          break;
        }
        case 'custom': {
          const mm = /^([^:]{1,40}):\s*(.+)$/.exec(v);
          const key = (f.data && f.data.key) || (mm ? mm[1].trim() : 'Info');
          const val = (f.data && f.data.value) || (mm ? mm[2].trim() : v);
          if (!m.custom.some(c => c.key === key && c.value === val)) m.custom.push({ key, value: val });
          break;
        }
        case 'notes': notes.push(v); break;
      }
    }
    if (notes.length) {
      const have = new Set((m.other.notes || '').split('\n').map(squash));
      const fresh = notes.filter(n => !have.has(squash(n)) && (have.add(squash(n)), true));
      if (fresh.length) m.other.notes = (m.other.notes ? m.other.notes + '\n' : '') + fresh.join('\n');
    }
    return m;
  }

  function pushPhone(m, type, value) {
    const d = value.replace(/\D/g, '');
    if (m.phones.some(p => p.number.replace(/\D/g, '').slice(-10) === d.slice(-10) && d.length >= 7)) return;
    m.phones.push({ type, cc: '', number: value });
  }

  window.CardParser = { parse, fieldsToModel, CATEGORIES, structureAddress, repairEmailChars, repairUrlChars, fixGstin };
})();
